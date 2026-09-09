import { bestStreak, currentStreak, isProvisional, recentForm } from '../domain/leaderboard/compute.js'
import type { PlayerMatchRecord } from '../domain/leaderboard/types.js'
import { goalsAgainst, goalsFor, resultFor } from '../domain/match/result.js'
import type { MatchResult } from '../domain/match/types.js'
import type { PlayerId } from '../domain/rating/types.js'
import { effectiveMatchesForPlayer } from '../infra/db/queries/match-effective.js'
import { findPlayerById } from '../infra/db/queries/players.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { latestSnapshotsFor } from '../infra/db/queries/ratings.js'
import { PlayerNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export interface PlayerProfile {
  playerId: PlayerId
  name: string
  isActive: boolean
  rating: number
  gamesPlayed: number
  wins: number
  draws: number
  losses: number
  form: readonly MatchResult[]
  streak: { result: MatchResult; length: number } | null
  bestStreak: { result: MatchResult; length: number } | null
  goalsFor: number
  goalsAgainst: number
  isProvisional: boolean
}

/**
 * Unlike leaderboard(), this works for deactivated players too — a profile is a historical
 * record, not a "who's currently playing" view. See docs/ARCHITECTURE.md#domain-model: players
 * are never deleted, only deactivated.
 */
export async function playerProfile(deps: Deps, playerId: string): Promise<PlayerProfile> {
  const player = await findPlayerById(deps.db, playerId)
  if (player === undefined) throw new PlayerNotFoundError(playerId)

  const { id: configId, config } = await getActiveRatingConfig(deps.db)
  const latest = await latestSnapshotsFor(deps.db, configId, [playerId])
  const rating = latest.get(playerId as PlayerId) ?? {
    rating: config.params.baseline,
    gamesPlayed: 0,
  }

  const matches = await effectiveMatchesForPlayer(deps.db, playerId)
  const records: PlayerMatchRecord[] = matches.map((match) => ({
    sequence: match.sequence,
    result: resultFor(match, playerId as PlayerId),
  }))

  return {
    playerId: playerId as PlayerId,
    name: player.name,
    isActive: player.isActive,
    rating: rating.rating,
    gamesPlayed: rating.gamesPlayed,
    wins: records.filter((record) => record.result === 'W').length,
    draws: records.filter((record) => record.result === 'D').length,
    losses: records.filter((record) => record.result === 'L').length,
    form: recentForm(records, 5),
    streak: currentStreak(records),
    bestStreak: bestStreak(records),
    goalsFor: matches.reduce((sum, m) => sum + goalsFor(m, playerId as PlayerId), 0),
    goalsAgainst: matches.reduce((sum, m) => sum + goalsAgainst(m, playerId as PlayerId), 0),
    isProvisional: isProvisional(rating.gamesPlayed, config.params.provisionalGames),
  }
}
