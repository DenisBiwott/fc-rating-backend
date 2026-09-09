import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PlayerNotFoundError } from '../../src/app/errors.js'
import { playerProfile } from '../../src/app/player-profile.js'
import { ratingHistory } from '../../src/app/rating-history.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { players } from '../../src/infra/db/schema.js'
import { testDeps } from './helpers/deps.js'
import { seedActiveConfig, seedPlayer, seedUser } from './helpers/factories.js'
import { createTestDb, type TestDb } from './helpers/test-db.js'

let testDb: TestDb
let db: Database
let userId: string
let playerAId: string
let playerBId: string

beforeAll(async () => {
  testDb = await createTestDb()
  db = testDb.db
  userId = (await seedUser(db)).id
  await seedActiveConfig(db)
  playerAId = (await seedPlayer(db, 'Alice')).id
  playerBId = (await seedPlayer(db, 'Bob')).id
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('playerProfile', () => {
  it('shows an unrated player at baseline with an empty form', async () => {
    const profile = await playerProfile(testDeps(db), playerAId)
    expect(profile).toMatchObject({
      name: 'Alice',
      isActive: true,
      rating: 1200,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    })
    expect(profile.form).toEqual([])
    expect(profile.streak).toBeNull()
    expect(profile.bestStreak).toBeNull()
    expect(profile.goalsFor).toBe(0)
    expect(profile.goalsAgainst).toBe(0)
    expect(profile.isProvisional).toBe(true)
    expect(profile.createdAt).toBeInstanceOf(Date)
  })

  it('reflects recorded matches', async () => {
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
    })

    const profile = await playerProfile(testDeps(db), playerAId)
    expect(profile.wins).toBe(1)
    expect(profile.gamesPlayed).toBe(1)
    expect(profile.rating).toBeGreaterThan(1200)
    expect(profile.form).toEqual(['W'])
    expect(profile.bestStreak).toEqual({ result: 'W', length: 1 })
    expect(profile.goalsFor).toBe(1)
    expect(profile.goalsAgainst).toBe(0)
  })

  it('finds the best streak even after it has ended, and sums goals across all matches', async () => {
    // Alice: W (2-0), W (1-0 away), W (3-1), L (0-2 away) — a 3-game streak that isn't current.
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 2,
      awayScore: 0,
      recordedBy: userId,
    })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerAId,
      homeScore: 0,
      awayScore: 1,
      recordedBy: userId,
    })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 3,
      awayScore: 1,
      recordedBy: userId,
    })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerAId,
      homeScore: 2,
      awayScore: 0,
      recordedBy: userId,
    })

    const profile = await playerProfile(testDeps(db), playerAId)
    expect(profile.wins).toBe(3)
    expect(profile.losses).toBe(1)
    expect(profile.streak).toEqual({ result: 'L', length: 1 })
    expect(profile.bestStreak).toEqual({ result: 'W', length: 3 })
    expect(profile.goalsFor).toBe(6) // 2 + 1 + 3 + 0
    expect(profile.goalsAgainst).toBe(3) // 0 + 0 + 1 + 2
  })

  it('still returns a profile for a deactivated player', async () => {
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
    })
    await db
      .update(players)
      .set({ isActive: false })
      .where(sql`${players.id} = ${playerAId}`)

    const profile = await playerProfile(testDeps(db), playerAId)
    expect(profile.isActive).toBe(false)
    expect(profile.wins).toBe(1)
  })

  it('throws PlayerNotFoundError for an unknown player', async () => {
    await expect(playerProfile(testDeps(db), randomUUID())).rejects.toBeInstanceOf(
      PlayerNotFoundError,
    )
  })
})

describe('ratingHistory', () => {
  it('returns one entry per match, in sequence order', async () => {
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
    })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerAId,
      homeScore: 0,
      awayScore: 1,
      recordedBy: userId,
    })

    const history = await ratingHistory(testDeps(db), playerAId)
    expect(history).toHaveLength(2)
    expect(history[0]?.sequence).toBeLessThan(history[1]?.sequence ?? Infinity)
    expect(history[0]?.after).toBe(history[1]?.before)
  })

  it('throws PlayerNotFoundError for an unknown player', async () => {
    await expect(ratingHistory(testDeps(db), randomUUID())).rejects.toBeInstanceOf(
      PlayerNotFoundError,
    )
  })
})
