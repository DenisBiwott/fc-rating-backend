import {
  currentStreak,
  isProvisional,
  rankPlayers,
  recentForm,
} from '../domain/leaderboard/compute.js'
import type { PlayerMatchRecord } from '../domain/leaderboard/types.js'
import { resultFor } from '../domain/match/result.js'
import type { MatchResult } from '../domain/match/types.js'
import type { PlayerId } from '../domain/rating/types.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { activePlayerRatings } from '../infra/db/queries/ratings.js'
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
}

/**
 * The active config's leaderboard, per docs/API.md. `gamesPlayed`/rating come from the rating
 * cache (rating_snapshots, via activePlayerRatings); W-L-D/form/streak are always freshly derived
 * from match_effective — the same split the leaderboard SQL view documents, kept here in app code
 * because the two derived facts (form[5], streak) aren't expressible as plain SQL aggregates.
 */
export async function leaderboard(deps: Deps): Promise<LeaderboardResult> {
  const { id: configId, name, config } = await getActiveRatingConfig(deps.db)
  const ratings = await activePlayerRatings(deps.db, configId, config.params.baseline)
  const effectiveMatches = (await allEffectiveMatches(deps.db)).filter((match) => !match.isVoid)

  const entries: LeaderboardEntry[] = rankPlayers(ratings).map((player) => {
    const records: PlayerMatchRecord[] = effectiveMatches
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
  }
}
