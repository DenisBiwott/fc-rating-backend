import type { EloParams, RatingState } from './types.js'

/**
 * E_home = 1 / (1 + 10^((R_away - R_home) / 400))
 * See fc-rating-backend/docs/ARCHITECTURE.md#rating-engine-domainrating for why this can look
 * zero-sum and isn't: K depends on each side's own gamesPlayed, not a shared bracket.
 */
export function expectedScore(ratingSelf: number, ratingOpponent: number): number {
  return 1 / (1 + Math.pow(10, (ratingOpponent - ratingSelf) / 400))
}

export function actualScore(selfScore: number, opponentScore: number): 1 | 0.5 | 0 {
  if (selfScore > opponentScore) return 1
  if (selfScore < opponentScore) return 0
  return 0.5
}

export function kFactor(state: RatingState, params: EloParams): number {
  return state.gamesPlayed < params.provisionalGames ? params.kProvisional : params.kEstablished
}

export function nextRating(
  state: RatingState,
  expected: number,
  actual: 1 | 0.5 | 0,
  params: EloParams,
): RatingState {
  const delta = kFactor(state, params) * (actual - expected)
  return { rating: state.rating + delta, gamesPlayed: state.gamesPlayed + 1 }
}
