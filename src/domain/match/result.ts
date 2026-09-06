import type { MatchInput, PlayerId } from '../rating/types.js'
import type { EffectiveMatch, MatchResult } from './types.js'

/** W/L/D from one player's perspective on an effective match. */
export function resultFor(match: EffectiveMatch, playerId: PlayerId): MatchResult {
  const isHome = match.homePlayerId === playerId
  const ownScore = isHome ? match.homeScore : match.awayScore
  const opponentScore = isHome ? match.awayScore : match.homeScore
  if (ownScore > opponentScore) return 'W'
  if (ownScore < opponentScore) return 'L'
  return 'D'
}

/** Strips replay-irrelevant fields (id, sequence, isVoid) for feeding into the rating engine. */
export function toMatchInput(match: EffectiveMatch): MatchInput {
  return {
    home: match.homePlayerId,
    away: match.awayPlayerId,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
  }
}
