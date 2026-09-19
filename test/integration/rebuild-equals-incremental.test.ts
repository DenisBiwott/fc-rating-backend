import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeSession } from '../../src/app/close-session.js'
import { correctMatch } from '../../src/app/correct-match.js'
import { openSession } from '../../src/app/open-session.js'
import { previewMatch } from '../../src/app/preview-match.js'
import { rebuildConfig } from '../../src/app/rebuild-config.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { voidMatch } from '../../src/app/void-match.js'
import { toMatchInputs } from '../../src/domain/match/result.js'
import { replay } from '../../src/domain/rating/engine.js'
import type { EliteK, EloParams, MatchInput } from '../../src/domain/rating/types.js'
import { allEffectiveMatches } from '../../src/infra/db/queries/match-effective.js'
import type { SnapshotRow } from '../../src/infra/db/queries/matches.js'
import { getRatingConfigById } from '../../src/infra/db/queries/rating-configs.js'
import { ratingSnapshots } from '../../src/infra/db/schema.js'
import { testDeps } from './helpers/deps.js'
import { activateNewConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

/**
 * The strongest correctness guarantee in the system (docs/TESTING.md): replaying the effective
 * match log from scratch gives byte-identical rating_snapshots to the incremental path. Run once
 * per rating-config variant — otherwise the guarantee silently narrows to whatever config the
 * fixture happens to use, and a feature that carries state across matches (elite hysteresis,
 * session meeting counts) could break it unnoticed.
 *
 * Every void/correct runs a full replay that rewrites ALL of the config's snapshot rows, so a
 * scenario ending in one would compare a replay against a replay. Each scenario therefore records
 * matches after its last adjustment, and the test asserts those incrementally written rows exist.
 */

const SEED_PARAMS = {
  baseline: 1200,
  kProvisional: 40,
  provisionalGames: 10,
  kEstablished: 24,
  drawScore: 0.5,
} as const

let testDb: TestDb
let db: Database
let userId: string
let A: string
let B: string
let C: string

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  userId = (await seedUser(db)).id
  A = (await seedPlayer(db, 'Alice')).id
  B = (await seedPlayer(db, 'Bob')).id
  C = (await seedPlayer(db, 'Carol')).id
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

interface Scenario {
  record(
    home: string,
    away: string,
    homeScore: number,
    awayScore: number,
    sessionId?: string,
  ): Promise<string>
  void(matchId: string): Promise<void>
  correct(
    matchId: string,
    home: string,
    away: string,
    homeScore: number,
    awayScore: number,
  ): Promise<void>
  openSession(name: string): Promise<string>
  closeSession(sessionId: string): Promise<void>
}

interface Evidence {
  rows: readonly SnapshotRow[]
  inputs: readonly MatchInput[] // the effective log as the engine sees it, in sequence order
  sequences: readonly number[] // matches.sequence for each entry of `inputs`
  lastReplaySequence: number // rows for matches after this one were written incrementally
}

interface Variant {
  name: string
  base?: Partial<EloParams> // non-feature overrides, kept when checking the features engaged
  features: Partial<EloParams>
  play: (scenario: Scenario) => Promise<void>
  guard?: (evidence: Evidence) => void
}

/** The pre-feature rebuild test's scenario, verbatim, plus matches recorded after its last adjustment. */
async function originalScenario(s: Scenario): Promise<void> {
  const m1 = await s.record(A, B, 1, 0)
  await s.record(B, C, 2, 2)
  await s.record(C, A, 0, 1)
  await s.void(m1)
  const m4 = await s.record(A, C, 3, 1)
  await s.correct(m4, A, C, 3, 3)
  // — incremental from here on
  await s.record(B, A, 5, 0)
  await s.record(C, B, 2, 1)
  await s.record(A, B, 1, 1)
}

const ELITE: EliteK = {
  enabled: true,
  enterAt: 1230,
  exitAt: 1215,
  k: 16,
  requireEstablished: true,
}

/**
 * Tuned (with provisionalGames 2) so that, all in the incremental tail, Alice enters elite, plays
 * three times as an elite player INSIDE the band, exits, then plays twice as a non-elite player
 * inside the band — the band is where the flag can't be recomputed from rating.
 */
async function eliteScenario(s: Scenario, sessionId?: string): Promise<void> {
  const r1 = await s.record(A, B, 1, 0, sessionId)
  const r2 = await s.record(C, B, 2, 1, sessionId)
  await s.void(r1)
  await s.record(A, C, 1, 0, sessionId)
  await s.correct(r2, B, C, 1, 0)
  // — incremental from here on
  await s.record(A, B, 1, 0, sessionId) // enters elite
  await s.record(A, C, 1, 0, sessionId)
  await s.record(B, A, 2, 0, sessionId)
  await s.record(C, A, 1, 0, sessionId) // drops into the band, still elite
  await s.record(A, B, 0, 0, sessionId) // plays as elite inside the band
  await s.record(C, A, 3, 1, sessionId)
  await s.record(B, A, 1, 0, sessionId) // exits below exitAt
  await s.record(A, C, 2, 0, sessionId) // back inside the band, not elite
  await s.record(B, A, 1, 1, sessionId)
}

const inBand = (rating: number) => rating >= ELITE.exitAt && rating < ELITE.enterAt

/** Consecutive (previous, next) snapshot rows per player, where `next` was written incrementally. */
function incrementalTransitions({ rows, lastReplaySequence }: Evidence) {
  const byPlayer = new Map<string, SnapshotRow[]>()
  for (const row of rows) byPlayer.set(row.playerId, [...(byPlayer.get(row.playerId) ?? []), row])
  return [...byPlayer.values()].flatMap((playerRows) =>
    playerRows
      .slice(1)
      .map((next, i) => ({ prev: playerRows[i] as SnapshotRow, next }))
      .filter(({ next }) => next.matchSequence > lastReplaySequence),
  )
}

function eliteGuard(evidence: Evidence): void {
  const transitions = incrementalTransitions(evidence)
  // Entered elite, and left it again — the band crossed in both directions, incrementally.
  expect(transitions.some(({ prev, next }) => !prev.isEliteAfter && next.isEliteAfter)).toBe(true)
  expect(transitions.some(({ prev, next }) => prev.isEliteAfter && !next.isEliteAfter)).toBe(true)
  // Played a match while elite AND inside the band: only a persisted flag gets this one right.
  expect(transitions.some(({ prev }) => prev.isEliteAfter && inBand(prev.ratingAfter))).toBe(true)
  // And the other half of the ambiguity: an established, non-elite player inside the band.
  expect(
    evidence.rows.some(
      (row) => !row.isEliteAfter && inBand(row.ratingAfter) && row.gamesPlayedAfter >= 2,
    ),
  ).toBe(true)
}

const DAMPING = { enabled: true, threshold: 1, factor: 0.5, minMultiplier: 0.25 }

async function dampingScenario(s: Scenario): Promise<void> {
  const friday = await s.openSession('Friday')
  const r1 = await s.record(A, B, 1, 0, friday)
  await s.record(A, B, 0, 1, friday)
  const r3 = await s.record(B, A, 2, 0, friday)
  await s.void(r1) // every later Alice–Bob meeting number in Friday shifts down by one
  await s.record(A, C, 1, 0, friday)
  await s.correct(r3, A, C, 1, 1) // no longer an Alice–Bob meeting at all
  // — incremental from here on
  await s.record(A, B, 3, 0, friday) // meeting 2 → damped
  await s.record(B, A, 1, 0, friday) // meeting 3 → damped harder
  await s.closeSession(friday)
  const saturday = await s.openSession('Saturday')
  await s.record(A, B, 1, 0, saturday) // a new session starts the count over
  await s.record(A, B, 2, 0) // no session — never a repeat
  await s.record(B, A, 2, 1, saturday) // meeting 2 of Saturday → damped
}

function dampingGuard({ inputs, sequences, lastReplaySequence }: Evidence): void {
  const priors = inputs
    .filter((_, i) => (sequences[i] ?? 0) > lastReplaySequence)
    .map((input) => input.priorSessionMeetings ?? 0)
  expect(priors.some((prior) => prior + 1 > DAMPING.threshold)).toBe(true)
  expect(priors.filter((prior) => prior === 0).length).toBeGreaterThanOrEqual(2) // Saturday's reset + the sessionless match
}

async function clampScenario(s: Scenario): Promise<void> {
  const r1 = await s.record(A, C, 1, 0)
  await s.record(B, C, 0, 0)
  await s.void(r1)
  const r3 = await s.record(C, B, 1, 0)
  await s.correct(r3, C, B, 2, 0)
  // — incremental from here on
  await s.record(A, B, 1, 0) // Alice +20 → clipped to +15; Bob 1200 − ... → floored
  await s.record(A, B, 4, 0) // Bob already at the floor, loses again
  await s.record(C, A, 1, 0)
}

function clampGuard({ rows, lastReplaySequence }: Evidence): void {
  const tail = rows.filter((row) => row.matchSequence > lastReplaySequence)
  expect(tail.some((row) => Math.abs(row.delta) === 15)).toBe(true) // maxDelta bit
  expect(tail.some((row) => row.ratingBefore === 1190 && row.ratingAfter === 1190)).toBe(true) // floor held
}

const VARIANTS: readonly Variant[] = [
  { name: 'default (no features)', features: {}, play: originalScenario },
  { name: 'expectationScale', features: { expectationScale: 600 }, play: originalScenario },
  {
    name: 'goalDifferenceFactor',
    features: { goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 } },
    play: originalScenario,
  },
  {
    name: 'eliteK, crossing the hysteresis band both ways',
    base: { provisionalGames: 2 },
    features: { eliteK: ELITE },
    play: (s) => eliteScenario(s),
    guard: eliteGuard,
  },
  {
    name: 'repeatOpponentDamping, across two sessions and a sessionless match',
    features: { repeatOpponentDamping: DAMPING },
    play: dampingScenario,
    guard: dampingGuard,
  },
  {
    name: 'maxDelta + ratingFloor',
    features: { maxDelta: 15, ratingFloor: 1190 },
    play: clampScenario,
    guard: clampGuard,
  },
  {
    name: 'every feature at once',
    base: { provisionalGames: 2 },
    features: {
      expectationScale: 500,
      goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 },
      eliteK: ELITE,
      repeatOpponentDamping: DAMPING,
      maxDelta: 25,
      ratingFloor: 1150,
    },
    play: async (s) => eliteScenario(s, await s.openSession('All-on')),
  },
]

async function snapshotsFor(configId: string): Promise<SnapshotRow[]> {
  const rows = await db.select().from(ratingSnapshots).where(eq(ratingSnapshots.configId, configId))
  return rows
    .map((row) => ({ ...row }))
    .sort((a, b) => a.matchSequence - b.matchSequence || a.playerId.localeCompare(b.playerId))
}

describe('rebuildConfig produces byte-identical snapshots to the incremental path', () => {
  it.each(VARIANTS)('$name', async ({ base = {}, features, play, guard }) => {
    const { id: configId } = await activateNewConfig(db, { ...base, ...features })

    let lastRecordedSequence = 0
    let lastReplaySequence = 0
    const deps = testDeps(db)
    await play({
      async record(home, away, homeScore, awayScore, sessionId) {
        const { match } = await recordMatch(deps, {
          id: randomUUID(),
          homePlayerId: home,
          awayPlayerId: away,
          homeScore,
          awayScore,
          recordedBy: userId,
          ...(sessionId === undefined ? {} : { sessionId }),
        })
        lastRecordedSequence = match.sequence
        return match.id
      },
      async void(matchId) {
        await voidMatch(deps, { matchId, reason: 'test', adjustedBy: userId })
        lastReplaySequence = lastRecordedSequence
      },
      async correct(matchId, home, away, homeScore, awayScore) {
        await correctMatch(deps, {
          matchId,
          reason: 'test',
          homePlayerId: home,
          awayPlayerId: away,
          homeScore,
          awayScore,
          adjustedBy: userId,
        })
        lastReplaySequence = lastRecordedSequence
      },
      async openSession(name) {
        return (await openSession(deps, { name, createdBy: userId })).id
      },
      async closeSession(sessionId) {
        await closeSession(deps, { sessionId })
      },
    })

    const incremental = await snapshotsFor(configId)
    // Guard against a vacuous comparison: some rows must have been written incrementally.
    expect(incremental.some((row) => row.matchSequence > lastReplaySequence)).toBe(true)

    await rebuildConfig(deps, configId)
    const rebuilt = await snapshotsFor(configId)

    expect(rebuilt).toEqual(incremental)

    const effective = (await allEffectiveMatches(db)).filter((match) => !match.isVoid)
    const inputs = toMatchInputs(effective)
    const { config } = await getRatingConfigById(db, configId)

    // Guard: the features actually changed something on this fixture — otherwise the variant
    // would silently re-test the default config.
    if (Object.keys(features).length > 0) {
      const withoutFeatures = { algorithm: 'elo' as const, params: { ...SEED_PARAMS, ...base } }
      expect(replay(inputs, config).table).not.toEqual(replay(inputs, withoutFeatures).table)
    }

    guard?.({
      rows: rebuilt,
      inputs,
      sequences: effective.map((match) => match.sequence),
      lastReplaySequence,
    })
  })
})

describe('previewMatch under repeat-opponent damping', () => {
  it('matches what recordMatch then records, when given the same session', async () => {
    await activateNewConfig(db, { repeatOpponentDamping: DAMPING })
    const deps = testDeps(db)
    const sessionId = (await openSession(deps, { name: 'Preview', createdBy: userId })).id
    const pair = { homePlayerId: A, awayPlayerId: B, homeScore: 1, awayScore: 0 }
    await recordMatch(deps, { id: randomUUID(), ...pair, sessionId, recordedBy: userId })

    const previewed = await previewMatch(deps, { ...pair, sessionId }) // meeting 2 → damped
    const sessionless = await previewMatch(deps, pair)
    const { outcome: recorded } = await recordMatch(deps, {
      id: randomUUID(),
      ...pair,
      sessionId,
      recordedBy: userId,
    })

    expect(previewed).toEqual(recorded)
    expect(Math.abs(sessionless.home.delta)).toBeGreaterThan(Math.abs(previewed.home.delta))
  })
})
