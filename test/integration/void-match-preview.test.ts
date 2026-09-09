import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MatchNotFoundError } from '../../src/app/errors.js'
import { leaderboard } from '../../src/app/leaderboard.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { voidMatch } from '../../src/app/void-match.js'
import { previewVoidMatch } from '../../src/app/void-match-preview.js'
import { matches, ratingSnapshots } from '../../src/infra/db/schema.js'
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
  userId = (await seedUser(db)).id
  await seedActiveConfig(db)
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

describe('previewVoidMatch', () => {
  it('reports the two direct participants when the match has no downstream ripple', async () => {
    const { match } = await record(playerAId, playerBId, 1, 0)

    const preview = await previewVoidMatch(testDeps(db), match.id)

    expect(preview.matchId).toBe(match.id)
    expect(preview.players.map((p) => p.playerId).sort()).toEqual([playerAId, playerBId].sort())
    // Both revert to the untouched baseline — it was the only match either played.
    const alice = preview.players.find((p) => p.playerId === playerAId)
    expect(alice).toMatchObject({ ratingAfter: 1200, gamesPlayedAfter: 0 })
  })

  it('matches what voidMatch() actually produces', async () => {
    const first = await record(playerAId, playerBId, 1, 0)
    await record(playerBId, playerCId, 1, 0)

    const preview = await previewVoidMatch(testDeps(db), first.match.id)

    const result = await voidMatch(testDeps(db), {
      matchId: first.match.id,
      reason: 'test',
      adjustedBy: userId,
    })
    const { entries } = await leaderboard(testDeps(db))

    for (const previewed of preview.players) {
      const real = entries.find((e) => e.playerId === previewed.playerId)
      expect(real?.rating).toBeCloseTo(previewed.ratingAfter, 9)
      expect(real?.gamesPlayed).toBe(previewed.gamesPlayedAfter)
    }
    expect(preview.players.map((p) => p.playerId).sort()).toEqual(
      result.affectedPlayers.slice().sort(),
    )
  })

  it('does not persist anything — matches and rating_snapshots are unchanged after previewing', async () => {
    const { match } = await record(playerAId, playerBId, 1, 0)

    const matchesBefore = await db.select().from(matches)
    const snapshotsBefore = await db.select().from(ratingSnapshots)

    await previewVoidMatch(testDeps(db), match.id)

    expect(await db.select().from(matches)).toEqual(matchesBefore)
    expect(await db.select().from(ratingSnapshots)).toEqual(snapshotsBefore)
  })

  it('reports a rank change when voiding sends a player back to 0 games', async () => {
    // Alice beats Carol first (still at full baseline confidence — the bigger Elo reward); Bob
    // beats Carol second, against an opponent already weakened by that first loss, so Bob's win
    // nets less. Alice ends up rank 1. Voiding Alice's one and only match sends her gamesPlayed
    // back to 0 — which rankPlayers() (src/domain/leaderboard/compute.ts) always sorts below
    // every player who's actually played, regardless of rating. A decisive, non-numeric rank
    // flip, unlike trying to engineer one from exact Elo deltas.
    const aliceMatch = await record(playerAId, playerCId, 1, 0)
    await record(playerBId, playerCId, 1, 0)

    const { entries: before } = await leaderboard(testDeps(db))
    expect(before.find((e) => e.playerId === playerAId)?.rank).toBe(1)

    const preview = await previewVoidMatch(testDeps(db), aliceMatch.match.id)

    const aliceRankChange = preview.rankChanges.find((c) => c.playerId === playerAId)
    expect(aliceRankChange).toBeDefined()
    expect(aliceRankChange?.from).toBe(1)
    expect(aliceRankChange?.to).toBeGreaterThan(1)
  })

  it('throws MatchNotFoundError for an unknown match id', async () => {
    await expect(previewVoidMatch(testDeps(db), randomUUID())).rejects.toBeInstanceOf(
      MatchNotFoundError,
    )
  })
})
