import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeSession } from '../../src/app/close-session.js'
import {
  SessionAlreadyClosedError,
  SessionAlreadyOpenError,
  SessionNotFoundError,
} from '../../src/app/errors.js'
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

    // Get A well ahead of B first (outside the session, so it doesn't affect matchCount), then
    // have the now-underdog B beat A inside the session.
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
    expect(summary.matchCount).toBe(1)
    expect(summary.upsetCount).toBe(1)
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
