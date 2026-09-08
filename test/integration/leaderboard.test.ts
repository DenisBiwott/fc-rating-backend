import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { leaderboard } from '../../src/app/leaderboard.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { testDeps } from './helpers/deps.js'
import { seedActiveConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

let testDb: TestDb
let db: Database
let userId: string
let playerAId: string
let playerBId: string
let playerCId: string

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  const user = await seedUser(db)
  userId = user.id
  await seedActiveConfig(db)
  playerAId = (await seedPlayer(db, 'Alice')).id
  playerBId = (await seedPlayer(db, 'Bob')).id
  playerCId = (await seedPlayer(db, 'Carol')).id // never plays — the zero-games case
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('leaderboard', () => {
  it('shows a never-played active player at baseline, unrated, with an empty form', async () => {
    const { entries } = await leaderboard(testDeps(db))
    const carol = entries.find((entry) => entry.playerId === playerCId)

    expect(carol).toMatchObject({ rating: 1200, gamesPlayed: 0, wins: 0, draws: 0, losses: 0 })
    expect(carol?.isProvisional).toBe(true)
    expect(carol?.form).toEqual([])
    expect(carol?.streak).toBeNull()
  })

  it('ranks by rating and reflects wins/losses/form after matches are recorded', async () => {
    // A beats B twice, then they draw — exercises rank ordering, W/L/D counts, and form order.
    for (const [homeScore, awayScore] of [
      [1, 0],
      [1, 0],
      [1, 1],
    ] as const) {
      await recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerBId,
        homeScore,
        awayScore,
        recordedBy: userId,
      })
    }

    const { entries, meanRating } = await leaderboard(testDeps(db))
    const alice = entries.find((entry) => entry.playerId === playerAId)
    const bob = entries.find((entry) => entry.playerId === playerBId)

    expect(alice?.rank).toBe(1)
    expect(alice).toMatchObject({ wins: 2, draws: 1, losses: 0, gamesPlayed: 3 })
    expect(alice?.form).toEqual(['W', 'W', 'D'])
    expect(alice?.streak).toEqual({ result: 'D', length: 1 })

    expect(bob).toMatchObject({ wins: 0, draws: 1, losses: 2, gamesPlayed: 3 })
    expect(bob?.rank).toBeGreaterThan(alice?.rank ?? 0)

    // meanRating averages every active player, including Carol who never played.
    const expectedMean = ((alice?.rating ?? 0) + (bob?.rating ?? 0) + 1200) / 3
    expect(meanRating).toBeCloseTo(expectedMean, 9)
  })

  it('flips isProvisional off once a player crosses provisionalGames', async () => {
    for (let i = 0; i < 10; i += 1) {
      await recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerBId,
        homeScore: 1,
        awayScore: 1,
        recordedBy: userId,
      })
    }

    const { entries } = await leaderboard(testDeps(db))
    const alice = entries.find((entry) => entry.playerId === playerAId)
    expect(alice?.gamesPlayed).toBe(10)
    expect(alice?.isProvisional).toBe(false)
  })
})
