import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { MatchValidationError } from '../../src/app/errors.js'
import { matches } from '../../src/infra/db/schema.js'
import { replay } from '../../src/domain/rating/engine.js'
import type { PlayerId, RatingConfig } from '../../src/domain/rating/types.js'
import { testDeps } from './helpers/deps.js'
import { seedActiveConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

let testDb: TestDb
let db: Database
let userId: string
let playerAId: string
let playerBId: string
let config: RatingConfig

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db

  const user = await seedUser(db)
  userId = user.id
  await seedActiveConfig(db)
  const playerA = await seedPlayer(db, 'Alice')
  const playerB = await seedPlayer(db, 'Bob')
  playerAId = playerA.id
  playerBId = playerB.id
  config = {
    algorithm: 'elo',
    params: {
      baseline: 1200,
      kProvisional: 40,
      provisionalGames: 10,
      kEstablished: 24,
      drawScore: 0.5,
    },
  }
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('recordMatch', () => {
  it('records a new match and returns the Elo outcome from the domain engine', async () => {
    const result = await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
    })

    expect(result.match.sequence).toBe(1)
    expect(result.outcome.home.delta).toBeCloseTo(20, 9) // both provisional, K=40 — see golden.test.ts
    expect(result.outcome.away.delta).toBeCloseTo(-20, 9)
    expect(result.outcome.home.after.gamesPlayed).toBe(1)
  })

  it('is idempotent on match id: a retried id returns the original result and writes nothing new', async () => {
    const id = randomUUID()
    const input = {
      id,
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 2,
      awayScore: 1,
      recordedBy: userId,
    }

    const first = await recordMatch(testDeps(db), input)
    const second = await recordMatch(testDeps(db), input)

    expect(second.match).toEqual(first.match)
    expect(second.outcome).toEqual(first.outcome)

    const rows = await db
      .select()
      .from(matches)
      .where(sql`${matches.id} = ${id}`)
    expect(rows).toHaveLength(1)
  })

  it('serializes two concurrent recordMatch calls under the advisory lock', async () => {
    const idA = randomUUID()
    const idB = randomUUID()
    const input = (id: string) => ({
      id,
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
    })

    const [resultA, resultB] = await Promise.all([
      recordMatch(testDeps(db), input(idA)),
      recordMatch(testDeps(db), input(idB)),
    ])

    const sequences = [resultA.match.sequence, resultB.match.sequence].sort((a, b) => a - b)
    expect(sequences).toEqual([1, 2])

    const [first, second] =
      resultA.match.sequence < resultB.match.sequence ? [resultA, resultB] : [resultB, resultA]

    // The second application must build on the first's resulting ratings — proof the lock
    // actually serialized these instead of both computing from the same stale pre-match state
    // (a lost-update bug would leave both landing on the *same* single-application numbers).
    expect(second.outcome.home.before.rating).toBeCloseTo(first.outcome.home.after.rating, 9)
    expect(second.outcome.away.before.rating).toBeCloseTo(first.outcome.away.after.rating, 9)
    expect(second.outcome.home.after.gamesPlayed).toBe(2)

    const expected = replay(
      [
        { home: playerAId as PlayerId, away: playerBId as PlayerId, homeScore: 1, awayScore: 0 },
        { home: playerAId as PlayerId, away: playerBId as PlayerId, homeScore: 1, awayScore: 0 },
      ],
      config,
    )
    expect(second.outcome.home.after.rating).toBeCloseTo(
      expected.table.get(playerAId as PlayerId)?.rating ?? NaN,
      6,
    )
    expect(second.outcome.away.after.rating).toBeCloseTo(
      expected.table.get(playerBId as PlayerId)?.rating ?? NaN,
      6,
    )
  })

  it('rejects a self-match before writing anything', async () => {
    await expect(
      recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerAId,
        homeScore: 1,
        awayScore: 0,
        recordedBy: userId,
      }),
    ).rejects.toBeInstanceOf(MatchValidationError)

    const rows = await db.select().from(matches)
    expect(rows).toHaveLength(0)
  })

  it('rejects an out-of-range score before writing anything', async () => {
    await expect(
      recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerBId,
        homeScore: 100,
        awayScore: 0,
        recordedBy: userId,
      }),
    ).rejects.toBeInstanceOf(MatchValidationError)
  })
})
