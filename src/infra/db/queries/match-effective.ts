import { sql, type SQL } from 'drizzle-orm'
import type { Queryable } from '../../../app/types.js'
import type { EffectiveMatch } from '../../../domain/match/types.js'
import { parseTimestamp } from '../raw-timestamp.js'

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

/**
 * The full match_effective row — a superset of the domain EffectiveMatch type (which only carries
 * what the pure overlay/replay logic needs). Kept separate rather than widening the shared domain
 * type: playedAt/session/recorded-by are HTTP list/detail concerns, not replay inputs.
 */
export interface EffectiveMatchDetail {
  id: string
  sequence: number
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
  isVoid: boolean
  playedAt: Date
  sessionId: string | null
  recordedBy: string
  recordedAt: Date
  decidedOnPenalties: boolean
}

type DetailRawRow = {
  id: string
  sequence: number
  home_player_id: string
  away_player_id: string
  home_score: number
  away_score: number
  is_void: boolean
  played_at: string
  session_id: string | null
  recorded_by: string
  recorded_at: string
  decided_on_penalties: boolean
}

function toEffectiveMatchDetail(row: DetailRawRow): EffectiveMatchDetail {
  return {
    id: row.id,
    sequence: row.sequence,
    homePlayerId: row.home_player_id,
    awayPlayerId: row.away_player_id,
    homeScore: row.home_score,
    awayScore: row.away_score,
    isVoid: row.is_void,
    playedAt: parseTimestamp(row.played_at),
    sessionId: row.session_id,
    recordedBy: row.recorded_by,
    recordedAt: parseTimestamp(row.recorded_at),
    decidedOnPenalties: row.decided_on_penalties,
  }
}

const DETAIL_COLUMNS = sql`id, sequence, home_player_id, away_player_id, home_score, away_score,
  is_void, played_at, session_id, recorded_by, recorded_at, decided_on_penalties`

export async function effectiveMatchDetailById(
  db: Queryable,
  matchId: string,
): Promise<EffectiveMatchDetail | undefined> {
  const rows = await db.execute<DetailRawRow>(sql`
    select ${DETAIL_COLUMNS} from match_effective where id = ${matchId}
  `)
  const row = rows[0]
  return row === undefined ? undefined : toEffectiveMatchDetail(row)
}

export interface ListEffectiveMatchesFilter {
  sessionId?: string
  playerId?: string
  includeVoided?: boolean
  cursor?: number
  limit: number
}

/**
 * Newest-first, cursor-paginated (cursor = sequence) per docs/API.md. Fetches one extra row past
 * `limit` so the caller (src/app/list-matches.ts) can tell whether there's a next page without a
 * separate count query.
 */
export async function listEffectiveMatches(
  db: Queryable,
  filter: ListEffectiveMatchesFilter,
): Promise<EffectiveMatchDetail[]> {
  const conditions: SQL[] = []
  if (filter.sessionId !== undefined) conditions.push(sql`session_id = ${filter.sessionId}`)
  if (filter.playerId !== undefined) {
    conditions.push(sql`(home_player_id = ${filter.playerId} or away_player_id = ${filter.playerId})`)
  }
  if (filter.includeVoided !== true) conditions.push(sql`not is_void`)
  if (filter.cursor !== undefined) conditions.push(sql`sequence < ${filter.cursor}`)

  const whereClause = conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``

  const rows = await db.execute<DetailRawRow>(sql`
    select ${DETAIL_COLUMNS} from match_effective
    ${whereClause}
    order by sequence desc
    limit ${filter.limit + 1}
  `)
  return rows.map(toEffectiveMatchDetail)
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
