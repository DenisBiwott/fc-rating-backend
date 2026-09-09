import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { correctMatch } from '../../src/app/correct-match.js'
import { MatchNotFoundError, MatchValidationError } from '../../src/app/errors.js'
import { leaderboard } from '../../src/app/leaderboard.js'
import { rebuildConfig } from '../../src/app/rebuild-config.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { voidMatch } from '../../src/app/void-match.js'
import { ratingSnapshots } from '../../src/infra/db/schema.js'
import { testDeps } from './helpers/deps.js'
import { seedActiveConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

let testDb: TestDb
let db: Database
let userId: string
let configId: string
let playerAId: string
let playerBId: string
let playerCId: string

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  userId = (await seedUser(db)).id
  configId = (await seedActiveConfig(db)).id
  playerAId = (await seedPlayer(db, 'Alice')).id
  playerBId = (await seedPlayer(db, 'Bob')).id
  playerCId = (await seedPlayer(db, 'Carol')).id
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

async function record(home: string, away: string, homeScore: number, awayScore: number) {
  return recordMatch(testDeps(db), {
    id: randomUUID(),
    homePlayerId: home,
    awayPlayerId: away,
    homeScore,
    awayScore,
    recordedBy: userId,
  })
}

async function allSnapshots() {
  return db.select().from(ratingSnapshots)
}

describe('voidMatch', () => {
  it('excludes the voided match from replay but keeps it in history', async () => {
    const { match } = await record(playerAId, playerBId, 1, 0)

    const result = await voidMatch(testDeps(db), {
      matchId: match.id,
      reason: 'test void',
      adjustedBy: userId,
    })

    expect(result.match.isVoid).toBe(true)
    expect(result.affectedPlayers).toEqual(expect.arrayContaining([playerAId, playerBId]))

    // Both players are back at the untouched baseline — the only match either played is voided.
    const { entries } = await leaderboard(testDeps(db))
    expect(entries.find((e) => e.playerId === playerAId)).toMatchObject({
      rating: 1200,
      gamesPlayed: 0,
    })
    expect(entries.find((e) => e.playerId === playerBId)).toMatchObject({
      rating: 1200,
      gamesPlayed: 0,
    })
  })

  it('ripples through a player who never played the voided match', async () => {
    // A beats B (#1), then B beats C (#2). Voiding #1 changes B's rating entering #2, which
    // changes C's snapshot too — even though C never played A. This is the transitive replay
    // effect from docs/ARCHITECTURE.md#derive-by-replay: replay recomputes every match in
    // sequence order, so an early correction cascades through every later match that used the
    // corrected player's rating as an input.
    const first = await record(playerAId, playerBId, 1, 0)
    await record(playerBId, playerCId, 1, 0)

    const before = (await leaderboard(testDeps(db))).entries.find((e) => e.playerId === playerCId)

    const result = await voidMatch(testDeps(db), {
      matchId: first.match.id,
      reason: 'ripple test',
      adjustedBy: userId,
    })

    expect(result.affectedPlayers).toContain(playerCId)

    const after = (await leaderboard(testDeps(db))).entries.find((e) => e.playerId === playerCId)
    expect(after?.rating).not.toBeCloseTo(before?.rating ?? NaN, 9)
  })

  it('throws MatchNotFoundError for an unknown match id', async () => {
    await expect(
      voidMatch(testDeps(db), { matchId: randomUUID(), reason: 'x', adjustedBy: userId }),
    ).rejects.toBeInstanceOf(MatchNotFoundError)
  })
})

describe('correctMatch', () => {
  it('overlays the replacement score and replays downstream ratings', async () => {
    const { match } = await record(playerAId, playerBId, 1, 0)

    const result = await correctMatch(testDeps(db), {
      matchId: match.id,
      reason: 'wrong score entered',
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 0,
      awayScore: 1,
      adjustedBy: userId,
    })

    expect(result.match).toMatchObject({ homeScore: 0, awayScore: 1, isVoid: false })

    const { entries } = await leaderboard(testDeps(db))
    const alice = entries.find((e) => e.playerId === playerAId)
    const bob = entries.find((e) => e.playerId === playerBId)
    // The outcome flipped: B is now the winner, so B should out-rate A.
    expect(bob?.rating ?? 0).toBeGreaterThan(alice?.rating ?? 0)
  })

  it('rejects an invalid replacement shape before writing an adjustment', async () => {
    const { match } = await record(playerAId, playerBId, 1, 0)

    await expect(
      correctMatch(testDeps(db), {
        matchId: match.id,
        reason: 'bad',
        homePlayerId: playerAId,
        awayPlayerId: playerAId,
        homeScore: 1,
        awayScore: 0,
        adjustedBy: userId,
      }),
    ).rejects.toBeInstanceOf(MatchValidationError)
  })
})

describe('rebuildConfig', () => {
  it('produces byte-identical snapshots to the incremental path — the strongest correctness guarantee in the system', async () => {
    // A representative sequence: some wins, a draw, then a void and a correct — exercising every
    // adjustment path before the rebuild has to reproduce the same end state from scratch.
    const m1 = await record(playerAId, playerBId, 1, 0)
    await record(playerBId, playerCId, 2, 2)
    await record(playerCId, playerAId, 0, 1)
    await voidMatch(testDeps(db), { matchId: m1.match.id, reason: 'void', adjustedBy: userId })
    const m4 = await record(playerAId, playerCId, 3, 1)
    await correctMatch(testDeps(db), {
      matchId: m4.match.id,
      reason: 'correct',
      homePlayerId: playerAId,
      awayPlayerId: playerCId,
      homeScore: 3,
      awayScore: 3,
      adjustedBy: userId,
    })

    const incremental = (await allSnapshots())
      .map((row) => ({ ...row }))
      .sort((a, b) => a.matchSequence - b.matchSequence || a.playerId.localeCompare(b.playerId))

    await rebuildConfig(testDeps(db), configId)

    const rebuilt = (await allSnapshots())
      .map((row) => ({ ...row }))
      .sort((a, b) => a.matchSequence - b.matchSequence || a.playerId.localeCompare(b.playerId))

    expect(rebuilt).toEqual(incremental)
  })
})
