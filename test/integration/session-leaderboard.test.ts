import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeSession } from '../../src/app/close-session.js'
import { SessionNotFoundError } from '../../src/app/errors.js'
import { leaderboard } from '../../src/app/leaderboard.js'
import { openSession } from '../../src/app/open-session.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { voidMatch } from '../../src/app/void-match.js'
import { players, sessions } from '../../src/infra/db/schema.js'
import { systemIds } from '../../src/infra/ids.js'
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
  await seedActiveConfig(db) // baseline 1200, kProvisional 40
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

async function record(
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
  sessionId?: string,
) {
  return recordMatch(testDeps(db), {
    id: randomUUID(),
    homePlayerId: home,
    awayPlayerId: away,
    homeScore,
    awayScore,
    recordedBy: userId,
    ...(sessionId === undefined ? {} : { sessionId }),
  })
}

/** testDeps() freezes the clock, so sessions that need distinct start times are inserted directly. */
async function insertSession(name: string, startedAt: string, endedAt: string | null) {
  const [row] = await db
    .insert(sessions)
    .values({
      id: systemIds.newId(),
      name,
      startedAt: new Date(startedAt),
      endedAt: endedAt === null ? null : new Date(endedAt),
      createdBy: userId,
    })
    .returning()
  if (row === undefined) throw new Error('insertSession: insert returned no row')
  return row
}

describe('leaderboard scope — which table by default', () => {
  it('is the all-time table when no session exists', async () => {
    await record(playerAId, playerBId, 1, 0)

    const board = await leaderboard(testDeps(db))
    expect(board.session).toBeNull()
    expect(board).toEqual(await leaderboard(testDeps(db), 'all-time'))
  })

  it('is the open session', async () => {
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })

    expect((await leaderboard(testDeps(db))).session).toEqual({ id: session.id, name: 'FC 27' })
  })

  it('is the most recently started closed session when none is open', async () => {
    await insertSession('FC 25', '2025-09-26T00:00:00Z', '2026-09-01T00:00:00Z')
    const fc26 = await insertSession('FC 26', '2026-09-14T00:00:00Z', '2026-09-26T00:00:00Z')

    expect((await leaderboard(testDeps(db))).session).toEqual({ id: fc26.id, name: 'FC 26' })
  })

  it('prefers the open session even over a later-started closed one', async () => {
    // Can't happen through the API (opening stamps "now", and only one can be open), but the rule
    // is "open first", not "newest first" — this pins it.
    const open = await insertSession('Open', '2026-01-01T00:00:00Z', null)
    await insertSession('Closed later', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z')

    expect((await leaderboard(testDeps(db))).session).toEqual({ id: open.id, name: 'Open' })
  })
})

describe('leaderboard scope — a session table', () => {
  it('starts everyone at baseline, whatever their all-time rating', async () => {
    for (let i = 0; i < 5; i += 1) await record(playerAId, playerBId, 1, 0) // no session
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    await record(playerAId, playerCId, 1, 0, session.id)

    const board = await leaderboard(testDeps(db), { sessionId: session.id })
    const entry = (playerId: string) => board.entries.find((e) => e.playerId === playerId)

    // One provisional-K win from level: 1200 ± 40 × 0.5.
    expect(entry(playerAId)).toMatchObject({ rating: 1220, gamesPlayed: 1, wins: 1, losses: 0 })
    expect(entry(playerCId)).toMatchObject({ rating: 1180, gamesPlayed: 1, wins: 0, losses: 1 })
    expect(entry(playerBId)).toMatchObject({ rating: 1200, gamesPlayed: 0, form: [] })

    const allTime = await leaderboard(testDeps(db), 'all-time')
    expect(allTime.entries.find((e) => e.playerId === playerAId)?.gamesPlayed).toBe(6)
  })

  it('equals the all-time table when the session holds every match', async () => {
    const session = await openSession(testDeps(db), { name: 'Only session', createdBy: userId })
    await record(playerAId, playerBId, 3, 1, session.id)
    await record(playerBId, playerCId, 2, 2, session.id)
    const voided = await record(playerCId, playerAId, 4, 0, session.id)
    await record(playerAId, playerCId, 0, 1, session.id)
    await voidMatch(testDeps(db), { matchId: voided.match.id, reason: 'x', adjustedBy: userId })
    await record(playerBId, playerAId, 1, 0, session.id)

    const bySession = await leaderboard(testDeps(db), { sessionId: session.id })
    const allTime = await leaderboard(testDeps(db), 'all-time')

    // Same matches in, same numbers out: replaySession (in memory) against rating_snapshots.
    expect(bySession.entries).toEqual(allTime.entries)
    expect(bySession.meanRating).toBe(allTime.meanRating)
    expect(bySession.session).toEqual({ id: session.id, name: 'Only session' })
    expect(allTime.session).toBeNull()
  })

  it('lists every active player — unplayed ones at baseline, last — and no inactive ones', async () => {
    const benched = await seedPlayer(db, `Benched-${randomUUID()}`)
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    await record(playerAId, benched.id, 1, 0, session.id)
    await db.update(players).set({ isActive: false }).where(eq(players.id, benched.id))

    const { entries } = await leaderboard(testDeps(db), { sessionId: session.id })
    expect(entries.map((e) => e.playerId).sort()).toEqual([playerAId, playerBId, playerCId].sort())
    expect(entries[0]).toMatchObject({ playerId: playerAId, gamesPlayed: 1 })
    expect(entries.slice(1).every((e) => e.rating === 1200 && e.gamesPlayed === 0)).toBe(true)
  })

  it("leaves out the session's voided matches", async () => {
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    const voided = await record(playerAId, playerBId, 1, 0, session.id)
    await record(playerBId, playerCId, 1, 0, session.id)
    await voidMatch(testDeps(db), { matchId: voided.match.id, reason: 'x', adjustedBy: userId })

    const { entries } = await leaderboard(testDeps(db), { sessionId: session.id })
    expect(entries.find((e) => e.playerId === playerAId)).toMatchObject({ gamesPlayed: 0 })
    expect(entries.find((e) => e.playerId === playerBId)).toMatchObject({
      rating: 1220,
      gamesPlayed: 1,
    })
  })

  it('still reads a closed session by id', async () => {
    const fc26 = await openSession(testDeps(db), { name: 'FC 26', createdBy: userId })
    await record(playerAId, playerBId, 1, 0, fc26.id)
    await closeSession(testDeps(db), { sessionId: fc26.id })
    const fc27 = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    await record(playerBId, playerAId, 1, 0, fc27.id)

    const board = await leaderboard(testDeps(db), { sessionId: fc26.id })
    expect(board.session).toEqual({ id: fc26.id, name: 'FC 26' })
    expect(board.entries.find((e) => e.playerId === playerAId)).toMatchObject({
      rating: 1220,
      wins: 1,
    })
  })

  it('throws SessionNotFoundError for an unknown session id', async () => {
    await expect(
      leaderboard(testDeps(db), { sessionId: randomUUID() }),
    ).rejects.toBeInstanceOf(SessionNotFoundError)
  })
})
