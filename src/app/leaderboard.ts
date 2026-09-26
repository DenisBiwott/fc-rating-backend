import {
  currentStreak,
  isProvisional,
  rankPlayers,
  recentForm,
} from '../domain/leaderboard/compute.js'
import type { PlayerMatchRecord, RatedPlayer } from '../domain/leaderboard/types.js'
import { resultFor } from '../domain/match/result.js'
import type { EffectiveMatch, MatchResult } from '../domain/match/types.js'
import type { PlayerId } from '../domain/rating/types.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { listPlayers } from '../infra/db/queries/players.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { activePlayerRatings } from '../infra/db/queries/ratings.js'
import {
  findLatestSession,
  findSessionById,
  type SessionRow,
} from '../infra/db/queries/sessions.js'
import { SessionNotFoundError } from './errors.js'
import { replaySession } from './session-replay.js'
import type { Deps } from './types.js'

export interface LeaderboardEntry {
  rank: number
  playerId: PlayerId
  rating: number
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  winPct: number
  form: readonly MatchResult[]
  streak: { result: MatchResult; length: number } | null
  isProvisional: boolean
}

export interface LeaderboardResult {
  entries: readonly LeaderboardEntry[]
  meanRating: number
  /**
   * Which config these ratings come from — the public view of it. Just enough for a client to
   * label the board and render "provisional N/M" without hardcoding either; the full params stay
   * behind the admin-only /rating-configs routes.
   */
  ratingConfig: { name: string; provisionalGames: number }
  /** The session whose own ladder this is; null for the all-time table. */
  session: { id: string; name: string } | null
}

/**
 * Which table to build. `latest-session` is the open session, else the most recently closed one,
 * else all-time when no session exists yet.
 */
export type LeaderboardScope = 'latest-session' | 'all-time' | { sessionId: string }

/**
 * The active config's leaderboard, per docs/API.md — every active player, ranked.
 *
 * All-time: rating/gamesPlayed come from the rating cache (rating_snapshots, via
 * activePlayerRatings). A session: they come from that session's own replay (replaySession), so
 * everyone starts it at baseline. Either way W-L-D/form/streak are derived fresh from the same
 * matches the ratings came from — kept here in app code because form[5] and streak aren't
 * expressible as plain SQL aggregates.
 */
export async function leaderboard(
  deps: Deps,
  scope: LeaderboardScope = 'latest-session',
): Promise<LeaderboardResult> {
  const { id: configId, name, config } = await getActiveRatingConfig(deps.db)
  const session = await resolveSession(deps, scope)

  let ratings: readonly RatedPlayer[]
  let matches: readonly EffectiveMatch[]
  if (session === undefined) {
    ratings = await activePlayerRatings(deps.db, configId, config.params.baseline)
    matches = (await allEffectiveMatches(deps.db)).filter((match) => !match.isVoid)
  } else {
    const replayed = await replaySession(deps.db, session.id, config)
    const activePlayers = await listPlayers(deps.db, { active: true })
    ratings = activePlayers.map((player) => {
      const state = replayed.table.get(player.id as PlayerId)
      return {
        playerId: player.id as PlayerId,
        rating: state?.rating ?? config.params.baseline,
        gamesPlayed: state?.gamesPlayed ?? 0,
      }
    })
    matches = replayed.matches
  }

  const entries: LeaderboardEntry[] = rankPlayers(ratings).map((player) => {
    const records: PlayerMatchRecord[] = matches
      .filter(
        (match) => match.homePlayerId === player.playerId || match.awayPlayerId === player.playerId,
      )
      .map((match) => ({ sequence: match.sequence, result: resultFor(match, player.playerId) }))

    const wins = records.filter((record) => record.result === 'W').length
    const draws = records.filter((record) => record.result === 'D').length
    const losses = records.filter((record) => record.result === 'L').length
    const gamesFromMatches = records.length

    return {
      rank: player.rank,
      playerId: player.playerId,
      rating: player.rating,
      gamesPlayed: player.gamesPlayed,
      wins,
      draws,
      losses,
      winPct: gamesFromMatches === 0 ? 0 : wins / gamesFromMatches,
      form: recentForm(records, 5),
      streak: currentStreak(records),
      isProvisional: isProvisional(player.gamesPlayed, config.params.provisionalGames),
    }
  })

  const meanRating =
    ratings.length === 0
      ? config.params.baseline
      : ratings.reduce((sum, player) => sum + player.rating, 0) / ratings.length

  return {
    entries,
    meanRating,
    ratingConfig: { name, provisionalGames: config.params.provisionalGames },
    session: session === undefined ? null : { id: session.id, name: session.name },
  }
}

async function resolveSession(
  deps: Deps,
  scope: LeaderboardScope,
): Promise<SessionRow | undefined> {
  if (scope === 'all-time') return undefined
  if (scope === 'latest-session') return findLatestSession(deps.db)
  const session = await findSessionById(deps.db, scope.sessionId)
  if (session === undefined) throw new SessionNotFoundError(scope.sessionId)
  return session
}
