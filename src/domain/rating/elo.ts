import type { EliteK, EloParams, MatchInput, RatingState } from './types.js'

/**
 * What the config schema fills in for a feature field left out at creation — the single source
 * for these values; the engine itself only ever falls back on expectationScale, for configs
 * stored before it existed.
 */
export const ELO_FEATURE_DEFAULTS = {
  expectationScale: 400,
  goalDifferenceFactor: { divisor: 2, cap: 1.5 },
  eliteK: { enterAt: 1500, exitAt: 1450, requireEstablished: true },
  repeatOpponentDamping: { threshold: 3, factor: 0.85, minMultiplier: 0.25 },
} as const

/**
 * E_home = 1 / (1 + 10^((R_away - R_home) / scale))
 * See fc-rating-backend/docs/ARCHITECTURE.md#rating-engine-domainrating for why this can look
 * zero-sum and isn't: K depends on each side's own gamesPlayed, not a shared bracket.
 */
export function expectedScore(
  ratingSelf: number,
  ratingOpponent: number,
  scale: number = ELO_FEATURE_DEFAULTS.expectationScale,
): number {
  return 1 / (1 + Math.pow(10, (ratingOpponent - ratingSelf) / scale))
}

export function actualScore(selfScore: number, opponentScore: number): 1 | 0.5 | 0 {
  if (selfScore > opponentScore) return 1
  if (selfScore < opponentScore) return 0
  return 0.5
}

function isProvisional(gamesPlayed: number, params: EloParams): boolean {
  return gamesPlayed < params.provisionalGames
}

// K resolution, in order — each step a pure function of (params, player state, match):
//   1. bracket K from the player's own gamesPlayed   (kFactor)
//   2. elite override replaces it while elite         (resolveBaseK)
//   3. goal-difference multiplier                     (goalDifferenceMultiplier)
//   4. repeat-opponent damping multiplier             (repeatOpponentMultiplier)
//   5. delta = K * (S - E)
//   6. clamp |delta| to maxDelta                      (clampDelta)
//   7. apply, then clamp the rating to ratingFloor    (applyRatingFloor)
// A disabled step contributes exactly 1 (x * 1 === x in IEEE 754) or is skipped, so with every
// feature off this is the same arithmetic as plain bracketed Elo, bit for bit.

/** Step 1: the player's own bracket K. */
export function kFactor(state: RatingState, params: EloParams): number {
  return isProvisional(state.gamesPlayed, params) ? params.kProvisional : params.kEstablished
}

function activeEliteK(state: RatingState, params: EloParams): EliteK | undefined {
  const eliteK = params.eliteK
  if (eliteK?.enabled !== true || state.isElite !== true) return undefined
  if (eliteK.requireEstablished && isProvisional(state.gamesPlayed, params)) return undefined
  return eliteK
}

/** Steps 1–2: bracket K, replaced by eliteK.k while the player is elite. */
export function resolveBaseK(state: RatingState, params: EloParams): number {
  return activeEliteK(state, params)?.k ?? kFactor(state, params)
}

/** Step 3: exactly 1 when off or when the goal difference is 0. */
export function goalDifferenceMultiplier(match: MatchInput, params: EloParams): number {
  const factor = params.goalDifferenceFactor
  if (factor?.enabled !== true) return 1
  const goalDifference = Math.abs(match.homeScore - match.awayScore)
  return Math.min(1 + Math.log1p(goalDifference) / factor.divisor, factor.cap)
}

/** Step 4: the same for both players — they share the pair, so they share the meeting number. */
export function repeatOpponentMultiplier(match: MatchInput, params: EloParams): number {
  const damping = params.repeatOpponentDamping
  if (damping?.enabled !== true) return 1
  const meeting = (match.priorSessionMeetings ?? 0) + 1
  if (meeting <= damping.threshold) return 1
  return Math.max(Math.pow(damping.factor, meeting - damping.threshold), damping.minMultiplier)
}

/** Steps 1–4. */
export function effectiveK(state: RatingState, match: MatchInput, params: EloParams): number {
  return (
    resolveBaseK(state, params) *
    goalDifferenceMultiplier(match, params) *
    repeatOpponentMultiplier(match, params)
  )
}

/** Step 6. Symmetric, so within a shared K bracket it preserves zero-sum; across brackets it can change the (already non-zero) sum. */
export function clampDelta(delta: number, params: EloParams): number {
  const max = params.maxDelta
  return max === undefined ? delta : Math.min(Math.max(delta, -max), max)
}

/** Step 7. Breaks zero-sum when it bites: the loser loses less than the winner gains. */
export function applyRatingFloor(rating: number, params: EloParams): number {
  return params.ratingFloor === undefined ? rating : Math.max(rating, params.ratingFloor)
}

/**
 * The elite flag for a player now at (rating, gamesPlayed), given whether they were elite
 * before. Undefined when eliteK is off — the state then carries no elite dimension at all.
 */
export function nextEliteStatus(
  wasElite: boolean,
  rating: number,
  gamesPlayed: number,
  params: EloParams,
): boolean | undefined {
  const eliteK = params.eliteK
  if (eliteK?.enabled !== true) return undefined
  if (eliteK.requireEstablished && isProvisional(gamesPlayed, params)) return false
  return wasElite ? rating >= eliteK.exitAt : rating >= eliteK.enterAt
}

/** Builds a RatingState, attaching the elite flag only under a config that has one. */
export function ratingState(
  rating: number,
  gamesPlayed: number,
  wasElite: boolean,
  params: EloParams,
): RatingState {
  const isElite = nextEliteStatus(wasElite, rating, gamesPlayed, params)
  return isElite === undefined ? { rating, gamesPlayed } : { rating, gamesPlayed, isElite }
}

export function nextRating(
  state: RatingState,
  expected: number,
  actual: 1 | 0.5 | 0,
  match: MatchInput,
  params: EloParams,
): RatingState {
  const delta = clampDelta(effectiveK(state, match, params) * (actual - expected), params)
  const rating = applyRatingFloor(state.rating + delta, params)
  return ratingState(rating, state.gamesPlayed + 1, state.isElite === true, params)
}
