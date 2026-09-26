import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeSession } from '../../src/app/close-session.js'
import {
  SessionAlreadyClosedError,
  SessionAlreadyOpenError,
  SessionNotFoundError,
} from '../../src/app/errors.js'
import { leaderboard } from '../../src/app/leaderboard.js'
import { openSession } from '../../src/app/open-session.js'
import { recordMatch } from '../../src/app/record-match.js'
import { sessionSummary } from '../../src/app/session-summary.js'
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

describe('openSession / closeSession', () => {
  it('opens and closes a session', async () => {
    const opened = await openSession(testDeps(db), { name: 'Friday Night', createdBy: userId })
    expect(opened.endedAt).toBeNull()

    const closed = await closeSession(testDeps(db), { sessionId: opened.id })
    expect(closed.endedAt).not.toBeNull()
  })

  it('rejects opening a second session while one is open', async () => {
    await openSession(testDeps(db), { name: 'First', createdBy: userId })
    await expect(
      openSession(testDeps(db), { name: 'Second', createdBy: userId }),
    ).rejects.toBeInstanceOf(SessionAlreadyOpenError)
  })

  it('allows opening a new session once the previous one is closed', async () => {
    const first = await openSession(testDeps(db), { name: 'First', createdBy: userId })
    await closeSession(testDeps(db), { sessionId: first.id })

    const second = await openSession(testDeps(db), { name: 'Second', createdBy: userId })
    expect(second.id).not.toBe(first.id)
  })

  it('rejects closing an already-closed session', async () => {
    const opened = await openSession(testDeps(db), { name: 'Friday Night', createdBy: userId })
    await closeSession(testDeps(db), { sessionId: opened.id })

    await expect(closeSession(testDeps(db), { sessionId: opened.id })).rejects.toBeInstanceOf(
      SessionAlreadyClosedError,
    )
  })

  it('rejects closing an unknown session', async () => {
    await expect(closeSession(testDeps(db), { sessionId: randomUUID() })).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
  })
})

describe('sessionSummary', () => {
  it('aggregates per-player deltas and biggest mover for matches recorded in the session', async () => {
    const session = await openSession(testDeps(db), { name: 'Friday Night', createdBy: userId })

    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
      sessionId: session.id,
    })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerCId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
      sessionId: session.id,
    })

    const summary = await sessionSummary(testDeps(db), session.id)

    expect(summary.matchCount).toBe(2)
    expect(summary.playerDeltas.map((d) => d.playerId).sort()).toEqual(
      [playerAId, playerBId, playerCId].sort(),
    )
    expect(summary.biggestMover).not.toBeNull()

    const totalDelta = summary.playerDeltas.reduce((sum, d) => sum + d.delta, 0)
    // Both matches were between two provisional players (same K), so each match is individually
    // zero-sum — the session total across all three players should be too.
    expect(totalDelta).toBeCloseTo(0, 6)
  })

  it('flags an upset when the pre-match underdog wins', async () => {
    const session = await openSession(testDeps(db), { name: 'Friday Night', createdBy: userId })

    // Get A well ahead of B within the session (the first of these is level, so no upset), then
    // have the now-underdog B beat A.
    for (let i = 0; i < 5; i += 1) {
      await recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerCId,
        homeScore: 1,
        awayScore: 0,
        recordedBy: userId,
        sessionId: session.id,
      })
    }

    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerAId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
      sessionId: session.id,
    })

    const summary = await sessionSummary(testDeps(db), session.id)
    expect(summary.matchCount).toBe(6)
    expect(summary.upsetCount).toBe(1)
  })

  it("reads the session's own ladder: an all-time upset isn't one when both start level", async () => {
    // A is well ahead of B all-time, but the session starts both at baseline.
    for (let i = 0; i < 5; i += 1) {
      await recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: playerAId,
        awayPlayerId: playerCId,
        homeScore: 1,
        awayScore: 0,
        recordedBy: userId,
      })
    }
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerBId,
      awayPlayerId: playerAId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
      sessionId: session.id,
    })

    const summary = await sessionSummary(testDeps(db), session.id)
    expect(summary.upsetCount).toBe(0)
    // One provisional-K result from level: ±40 × 0.5.
    expect(summary.playerDeltas).toEqual(
      expect.arrayContaining([
        { playerId: playerBId, delta: 20 },
        { playerId: playerAId, delta: -20 },
      ]),
    )
  })

  it("gives each player their session-table rating minus baseline as their delta", async () => {
    const session = await openSession(testDeps(db), { name: 'FC 27', createdBy: userId })
    const results: [string, string, number, number][] = [
      [playerAId, playerBId, 3, 1],
      [playerBId, playerCId, 0, 2],
      [playerCId, playerAId, 1, 1],
      [playerAId, playerCId, 2, 0],
    ]
    for (const [home, away, homeScore, awayScore] of results) {
      await recordMatch(testDeps(db), {
        id: randomUUID(),
        homePlayerId: home,
        awayPlayerId: away,
        homeScore,
        awayScore,
        recordedBy: userId,
        sessionId: session.id,
      })
    }

    const summary = await sessionSummary(testDeps(db), session.id)
    const { entries } = await leaderboard(testDeps(db), { sessionId: session.id })
    for (const { playerId, delta } of summary.playerDeltas) {
      const rating = entries.find((e) => e.playerId === playerId)?.rating ?? NaN
      expect(delta).toBeCloseTo(rating - 1200, 9)
    }
    expect(summary.playerDeltas).toHaveLength(3)
  })

  it('excludes matches recorded outside the session', async () => {
    const session = await openSession(testDeps(db), { name: 'Friday Night', createdBy: userId })

    await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
      recordedBy: userId,
      // no sessionId — an ad-hoc match recorded while no session is open
    })

    const summary = await sessionSummary(testDeps(db), session.id)
    expect(summary.matchCount).toBe(0)
    expect(summary.playerDeltas).toEqual([])
  })

  it('throws SessionNotFoundError for an unknown session', async () => {
    await expect(sessionSummary(testDeps(db), randomUUID())).rejects.toBeInstanceOf(
      SessionNotFoundError,
    )
  })
})
