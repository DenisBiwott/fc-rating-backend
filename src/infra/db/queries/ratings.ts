import { eq, sql } from 'drizzle-orm'
import type { Queryable, Transaction } from '../../../app/types.js'
import type { RatedPlayer } from '../../../domain/leaderboard/types.js'
import type { PlayerId, RatingState, RatingTable } from '../../../domain/rating/types.js'
import { ratingSnapshots } from '../schema.js'

type LatestSnapshotRow = {
  player_id: string
  rating_after: number
  games_played_after: number
}

/**
 * Latest rating_snapshots row per player, for the given config and player set. A player missing
 * from the returned map has no snapshot yet — callers fall back to the domain's initialState.
 */
export async function latestSnapshotsFor(
  db: Queryable,
  configId: string,
  playerIds: readonly string[],
): Promise<Map<PlayerId, { rating: number; gamesPlayed: number }>> {
  const result = new Map<PlayerId, { rating: number; gamesPlayed: number }>()
  if (playerIds.length === 0) return result

  const rows = await db.execute<LatestSnapshotRow>(sql`
    select distinct on (player_id) player_id, rating_after, games_played_after
    from rating_snapshots
    where config_id = ${configId} and player_id in ${playerIds}
    order by player_id, match_sequence desc
  `)

  for (const row of rows) {
    result.set(row.player_id as PlayerId, {
      rating: row.rating_after,
      gamesPlayed: row.games_played_after,
    })
  }
  return result
}

type ActiveRatingRow = {
  player_id: string
  rating: number
  games_played: number
}

/**
 * Every active player's current rating for this config — baseline rating and zero games played
 * when they haven't played yet, per design doc §4.1 (the leaderboard view's documented union).
 */
export async function activePlayerRatings(
  db: Queryable,
  configId: string,
  baseline: number,
): Promise<RatedPlayer[]> {
  const rows = await db.execute<ActiveRatingRow>(sql`
    select p.id as player_id,
           coalesce(latest.rating_after, ${baseline}) as rating,
           coalesce(latest.games_played_after, 0) as games_played
    from players p
    left join lateral (
      select rating_after, games_played_after
      from rating_snapshots rs
      where rs.player_id = p.id and rs.config_id = ${configId}
      order by rs.match_sequence desc
      limit 1
    ) latest on true
    where p.is_active
  `)

  return rows.map((row) => ({
    playerId: row.player_id as PlayerId,
    rating: row.rating,
    gamesPlayed: row.games_played,
  }))
}

/** Latest snapshot per player for this config, across every player who has ever had one — not just active players. Used to diff before/after a replay (void/correct/rebuild). */
export async function allLatestSnapshots(db: Queryable, configId: string): Promise<RatingTable> {
  const rows = await db.execute<LatestSnapshotRow>(sql`
    select distinct on (player_id) player_id, rating_after, games_played_after
    from rating_snapshots
    where config_id = ${configId}
    order by player_id, match_sequence desc
  `)

  const table = new Map<PlayerId, RatingState>()
  for (const row of rows) {
    table.set(row.player_id as PlayerId, {
      rating: row.rating_after,
      gamesPlayed: row.games_played_after,
    })
  }
  return table
}

export async function deleteSnapshotsForConfig(tx: Transaction, configId: string): Promise<void> {
  await tx.delete(ratingSnapshots).where(eq(ratingSnapshots.configId, configId))
}

export interface RatingHistoryEntry {
  matchId: string
  sequence: number
  playedAt: Date
  before: number
  after: number
  delta: number
}

type RatingHistoryRow = {
  match_id: string
  sequence: number
  played_at: Date
  rating_before: number
  rating_after: number
  delta: number
}

/** One player's rating trajectory for a config, in match order — powers the profile sparkline. */
export async function ratingHistoryForPlayer(
  db: Queryable,
  configId: string,
  playerId: string,
): Promise<RatingHistoryEntry[]> {
  const rows = await db.execute<RatingHistoryRow>(sql`
    select rs.match_id, rs.match_sequence as sequence, m.played_at, rs.rating_before, rs.rating_after, rs.delta
    from rating_snapshots rs
    join matches m on m.id = rs.match_id
    where rs.config_id = ${configId} and rs.player_id = ${playerId}
    order by rs.match_sequence
  `)

  return rows.map((row) => ({
    matchId: row.match_id,
    sequence: row.sequence,
    playedAt: row.played_at,
    before: row.rating_before,
    after: row.rating_after,
    delta: row.delta,
  }))
}
