import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MatchValidationError } from '../../src/app/errors.js'
import { previewMatch } from '../../src/app/preview-match.js'
import { recordMatch } from '../../src/app/record-match.js'
import type { Database } from '../../src/app/types.js'
import { matches } from '../../src/infra/db/schema.js'
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
  const user = await seedUser(db)
  userId = user.id
  await seedActiveConfig(db)
  const playerA = await seedPlayer(db, 'Alice')
  const playerB = await seedPlayer(db, 'Bob')
  playerAId = playerA.id
  playerBId = playerB.id
})

afterEach(async () => {
  await db.execute(
    sql`truncate table matches, rating_snapshots, match_adjustments, sessions restart identity cascade`,
  )
})

afterAll(async () => {
  await testDb.teardown()
})

describe('previewMatch', () => {
  it('writes nothing to the database', async () => {
    await previewMatch(testDeps(db), {
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 1,
      awayScore: 0,
    })

    const rows = await db.select().from(matches)
    expect(rows).toHaveLength(0)
  })

  it('matches what recordMatch would actually produce for the same input', async () => {
    const preview = await previewMatch(testDeps(db), {
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 3,
      awayScore: 1,
    })

    const recorded = await recordMatch(testDeps(db), {
      id: randomUUID(),
      homePlayerId: playerAId,
      awayPlayerId: playerBId,
      homeScore: 3,
      awayScore: 1,
      recordedBy: userId,
    })

    expect(preview).toEqual(recorded.outcome)
  })

  it('rejects a self-match', async () => {
    await expect(
      previewMatch(testDeps(db), {
        homePlayerId: playerAId,
        awayPlayerId: playerAId,
        homeScore: 1,
        awayScore: 0,
      }),
    ).rejects.toBeInstanceOf(MatchValidationError)
  })
})
