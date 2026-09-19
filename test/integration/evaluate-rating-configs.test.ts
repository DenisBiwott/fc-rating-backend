import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { evaluateRatingConfigs } from '../../src/app/evaluate-rating-configs.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import type { EloParams } from '../../src/domain/rating/types.js'
import { insertRatingConfig } from '../../src/infra/db/queries/rating-configs.js'
import { testDeps } from './helpers/deps.js'
import { seedActiveConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

const DEFAULT: EloParams = {
  baseline: 1200,
  kProvisional: 40,
  provisionalGames: 10,
  kEstablished: 24,
  drawScore: 0.5,
}

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
  await seedActiveConfig(db)
  await insertRatingConfig(db, {
    id: randomUUID(),
    name: 'stored-high-k',
    algorithm: 'elo',
    params: { ...DEFAULT, kEstablished: 40 },
  })
  A = (await seedPlayer(db, 'Alice')).id
  B = (await seedPlayer(db, 'Bob')).id
  C = (await seedPlayer(db, 'Carol')).id
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

async function record(home: string, away: string, homeScore: number, awayScore: number) {
  await recordMatch(testDeps(db), {
    id: randomUUID(),
    homePlayerId: home,
    awayPlayerId: away,
    homeScore,
    awayScore,
    recordedBy: userId,
  })
}

const candidates = [
  { name: 'same-as-active', params: DEFAULT },
  {
    name: 'with-gd',
    params: { ...DEFAULT, goalDifferenceFactor: { enabled: true, divisor: 3, cap: 1.5 } },
  },
]

describe('evaluateRatingConfigs', () => {
  it('scores every stored config and every candidate against the same effective log', async () => {
    const results: [string, string, number, number][] = [
      [A, B, 3, 0],
      [B, C, 1, 1],
      [C, A, 2, 1],
      [A, B, 1, 0],
      [B, C, 0, 2],
      [A, C, 4, 1],
      [B, A, 2, 2],
    ]
    for (const [home, away, homeScore, awayScore] of results)
      await record(home, away, homeScore, awayScore)

    const { matchCount, evaluations } = await evaluateRatingConfigs(testDeps(db), candidates)

    expect(matchCount).toBe(results.length)
    const named = (source: string) =>
      evaluations
        .filter((e) => e.source === source)
        .map((e) => e.name)
        .sort()
    expect(named('active')).toHaveLength(1)
    expect(named('stored')).toEqual(['stored-high-k'])
    expect(named('candidate')).toEqual(['same-as-active', 'with-gd'])
    const briers = evaluations.map((e) => e.all.brier ?? Infinity)
    expect(briers).toEqual([...briers].sort((a, b) => a - b)) // ranked best first

    // The in-memory replay agrees with what the incremental path actually persisted for the
    // active config — both sides of a match score the same, so averaging every row is Brier.
    const active = evaluations.find((e) => e.source === 'active')
    const [persisted] = await db.execute<{ brier: number }>(sql`
      select avg((expected_score - actual_score)^2) as brier
      from rating_snapshots s join rating_configs c on c.id = s.config_id where c.is_active
    `)
    expect(active?.all.brier).toBeCloseTo(persisted?.brier ?? NaN, 12)
    expect(active?.vsActive).toBeNull()

    const twin = evaluations.find((e) => e.name === 'same-as-active')
    expect(twin?.all).toEqual(active?.all)
    expect(twin?.vsActive).toEqual({ difference: 0, standardError: 0 })

    const withGd = evaluations.find((e) => e.name === 'with-gd')
    expect(withGd?.all.brier).not.toBe(active?.all.brier)
  })

  it('writes nothing', async () => {
    await record(A, B, 1, 0)
    const count = async () =>
      (
        await db.execute<{ configs: number; snapshots: number }>(sql`
          select (select count(*)::int from rating_configs) as configs,
                 (select count(*)::int from rating_snapshots) as snapshots
        `)
      )[0]
    const before = await count()

    await evaluateRatingConfigs(testDeps(db), candidates)

    expect(await count()).toEqual(before)
  })

  it('handles an empty match log — no scores, no crash', async () => {
    const { matchCount, evaluations } = await evaluateRatingConfigs(testDeps(db), candidates)
    expect(matchCount).toBe(0)
    for (const evaluation of evaluations) {
      expect(evaluation.all).toEqual({ matches: 0, brier: null, logLoss: null })
      expect(evaluation.vsActive).toBeNull()
    }
  })
})
