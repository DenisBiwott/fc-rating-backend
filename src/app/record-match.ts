import { sql } from 'drizzle-orm'
import type { RatedPlayer } from '../domain/leaderboard/types.js'
import { applyMatch } from '../domain/rating/engine.js'
import type {
  MatchOutcome,
  ParticipantOutcome,
  PlayerId,
  RatingState,
} from '../domain/rating/types.js'
import {
  findMatchById,
  insertMatch,
  insertSnapshots,
  snapshotsForMatch,
  type MatchRow,
} from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { activePlayerRatings, latestSnapshotsFor } from '../infra/db/queries/ratings.js'
import { candidateMatchInput } from './candidate-match-input.js'
import { outcomeFromSnapshotRows } from './reconstruct-outcome.js'
import { diffRanks, type RankChange } from './replay.js'
import { toSnapshotRow } from './snapshot-mapper.js'
import type { Deps, Queryable, Transaction } from './types.js'
import { validateMatchShape } from './validation.js'

export interface RecordMatchInput {
  id: string
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
  decidedOnPenalties?: boolean
  playedAt?: Date
  sessionId?: string
  recordedBy: string
}

export interface MatchDto {
  id: string
  sequence: number
  homePlayerId: PlayerId
  awayPlayerId: PlayerId
  homeScore: number
  awayScore: number
  decidedOnPenalties: boolean
  playedAt: Date
  sessionId: string | null
  recordedBy: string
}

export interface RecordMatchResult {
  match: MatchDto
  outcome: MatchOutcome
  rankChanges: readonly RankChange[]
}

function toMatchDto(row: MatchRow): MatchDto {
  return {
    id: row.id,
    sequence: row.sequence,
    homePlayerId: row.homePlayerId as PlayerId,
    awayPlayerId: row.awayPlayerId as PlayerId,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    decidedOnPenalties: row.decidedOnPenalties,
    playedAt: row.playedAt,
    sessionId: row.sessionId,
    recordedBy: row.recordedBy,
  }
}

async function loadDuplicateResult(
  db: Queryable,
  existing: MatchRow,
  configId: string,
  provisionalGames: number,
): Promise<RecordMatchResult> {
  const snapshots = await snapshotsForMatch(db, configId, existing.id)
  const outcome = outcomeFromSnapshotRows(existing, snapshots, provisionalGames)
  // Historical rank movement isn't reconstructed on retry — see docs/API.md#idempotency. Ratings
  // and deltas are exact either way; only the "rank changed" fanfare is skipped on a retried call.
  return { match: toMatchDto(existing), outcome, rankChanges: [] }
}

function withUpdatedRating(
  players: readonly RatedPlayer[],
  participant: ParticipantOutcome,
): RatedPlayer[] {
  return players.map((player) =>
    player.playerId === participant.playerId
      ? { ...player, rating: participant.after.rating, gamesPlayed: participant.after.gamesPlayed }
      : player,
  )
}

async function recordUnderLock(
  tx: Transaction,
  input: RecordMatchInput,
  playedAt: Date,
): Promise<RecordMatchResult> {
  const { id: configId, config } = await getActiveRatingConfig(tx)

  // Every rating-affecting write serializes on this lock — see docs/ARCHITECTURE.md#concurrency-model.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${configId}))`)

  // Re-check: a concurrent request for this same id may have committed while we waited for the lock.
  const raceWinner = await findMatchById(tx, input.id)
  if (raceWinner !== undefined) {
    return loadDuplicateResult(tx, raceWinner, configId, config.params.provisionalGames)
  }

  const before = await activePlayerRatings(tx, configId, config.params.baseline)
  const latest = await latestSnapshotsFor(tx, configId, [input.homePlayerId, input.awayPlayerId])

  const table = new Map<PlayerId, RatingState>()
  const homeId = input.homePlayerId as PlayerId
  const awayId = input.awayPlayerId as PlayerId
  const homeRating = latest.get(homeId)
  const awayRating = latest.get(awayId)
  if (homeRating !== undefined) table.set(homeId, homeRating)
  if (awayRating !== undefined) table.set(awayId, awayRating)

  const { outcome } = applyMatch(table, await candidateMatchInput(tx, config, input), config)

  const matchRow = await insertMatch(tx, {
    id: input.id,
    homePlayerId: input.homePlayerId,
    awayPlayerId: input.awayPlayerId,
    homeScore: input.homeScore,
    awayScore: input.awayScore,
    decidedOnPenalties: input.decidedOnPenalties ?? false,
    playedAt,
    sessionId: input.sessionId ?? null,
    recordedBy: input.recordedBy,
  })

  await insertSnapshots(tx, [
    toSnapshotRow(configId, matchRow, outcome.home),
    toSnapshotRow(configId, matchRow, outcome.away),
  ])

  const after = withUpdatedRating(withUpdatedRating(before, outcome.home), outcome.away)
  const rankChanges = diffRanks(before, after)

  return { match: toMatchDto(matchRow), outcome, rankChanges }
}

/**
 * Idempotent on input.id: a previously-recorded id returns the original result (200-equivalent),
 * never an error — see docs/API.md#idempotency. New matches are recorded inside a transaction
 * serialized by the active config's advisory lock.
 */
export async function recordMatch(deps: Deps, input: RecordMatchInput): Promise<RecordMatchResult> {
  validateMatchShape(input)

  const existing = await findMatchById(deps.db, input.id)
  if (existing !== undefined) {
    deps.logger.info('recordMatch: duplicate id, returning original result', { matchId: input.id })
    const { id: configId, config } = await getActiveRatingConfig(deps.db)
    return loadDuplicateResult(deps.db, existing, configId, config.params.provisionalGames)
  }

  const playedAt = input.playedAt ?? deps.clock.now()
  const result = await deps.db.transaction((tx) => recordUnderLock(tx, input, playedAt))
  deps.logger.info('recordMatch: recorded', {
    matchId: result.match.id,
    sequence: result.match.sequence,
  })
  return result
}
