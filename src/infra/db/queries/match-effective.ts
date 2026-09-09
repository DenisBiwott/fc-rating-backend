import { sql } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import type { EffectiveMatch } from '../../../domain/match/types.js'

type RawRow = {
  id: string
  sequence: number
  home_player_id: string
  away_player_id: string
  home_score: number
  away_score: number
  is_void: boolean
}

function toEffectiveMatch(row: RawRow): EffectiveMatch {
  return {
    id: row.id,
    sequence: row.sequence,
    homePlayerId: row.home_player_id as EffectiveMatch['homePlayerId'],
    awayPlayerId: row.away_player_id as EffectiveMatch['awayPlayerId'],
    homeScore: row.home_score,
    awayScore: row.away_score,
    isVoid: row.is_void,
  }
}

/** Reads the match_effective view (docs/DATABASE.md#views) — the current truth of every match. */
export async function allEffectiveMatches(db: Queryable): Promise<EffectiveMatch[]> {
  const rows = await db.execute<RawRow>(sql`
    select id, sequence, home_player_id, away_player_id, home_score, away_score, is_void
    from match_effective
    order by sequence
  `)
  return rows.map(toEffectiveMatch)
}

export async function effectiveMatchById(
  db: Queryable,
  matchId: string,
): Promise<EffectiveMatch | undefined> {
  const rows = await db.execute<RawRow>(sql`
    select id, sequence, home_player_id, away_player_id, home_score, away_score, is_void
    from match_effective
    where id = ${matchId}
  `)
  const row = rows[0]
  return row === undefined ? undefined : toEffectiveMatch(row)
}

export async function effectiveMatchesForPlayer(
  db: Queryable,
  playerId: string,
): Promise<EffectiveMatch[]> {
  const rows = await db.execute<RawRow>(sql`
    select id, sequence, home_player_id, away_player_id, home_score, away_score, is_void
    from match_effective
    where (home_player_id = ${playerId} or away_player_id = ${playerId}) and not is_void
    order by sequence
  `)
  return rows.map(toEffectiveMatch)
}

export async function effectiveMatchesForSession(
  db: Queryable,
  sessionId: string,
): Promise<EffectiveMatch[]> {
  const rows = await db.execute<RawRow>(sql`
    select id, sequence, home_player_id, away_player_id, home_score, away_score, is_void
    from match_effective
    where session_id = ${sessionId} and not is_void
    order by sequence
  `)
  return rows.map(toEffectiveMatch)
}
