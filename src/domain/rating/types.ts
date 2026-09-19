/**
 * Pure types for the rating engine. No imports outside this package — see
 * fc-rating-backend/docs/ARCHITECTURE.md#domain-model for the reasoning.
 */

export type PlayerId = string & { readonly __brand: 'PlayerId' }

/** K multiplier `min(1 + ln(1 + |goal difference|) / divisor, cap)`, applied to both sides equally. */
export interface GoalDifferenceFactor {
  readonly enabled: boolean
  readonly divisor: number
  readonly cap: number
}

/**
 * While elite, a player's K is `k` instead of their bracket value. Hysteresis: enter at
 * rating >= enterAt, leave only once rating < exitAt.
 */
export interface EliteK {
  readonly enabled: boolean
  readonly enterAt: number
  readonly exitAt: number
  readonly k: number
  readonly requireEstablished: boolean // a provisional player is never elite
}

/** For the n-th meeting of a pair within one session, n > threshold scales K by max(factor^(n - threshold), minMultiplier). */
export interface RepeatOpponentDamping {
  readonly enabled: boolean
  readonly threshold: number
  readonly factor: number
  readonly minMultiplier: number
}

/**
 * Every field after drawScore is an optional refinement, off when absent (or `enabled: false`)
 * — with all of them off the engine is bit-identical to plain bracketed Elo. Nested fields are
 * required here: the config schema fills their defaults (ELO_FEATURE_DEFAULTS) before a config
 * is ever stored, so a stored config's meaning never depends on a code-level default.
 */
export interface EloParams {
  readonly baseline: number // 1200
  readonly kProvisional: number // 40 — applied while gamesPlayed < provisionalGames
  readonly provisionalGames: number // 10
  readonly kEstablished: number // 24
  readonly drawScore: 0.5 // fixed; typed as literal so nobody "configures" it
  readonly expectationScale?: number // the 400 in 1 / (1 + 10^(diff / scale)); absent = 400
  readonly goalDifferenceFactor?: GoalDifferenceFactor
  readonly eliteK?: EliteK
  readonly repeatOpponentDamping?: RepeatOpponentDamping
  readonly maxDelta?: number // clamps |delta| per match
  readonly ratingFloor?: number // clamps the resulting rating from below
}

export type RatingConfig = { readonly algorithm: 'elo'; readonly params: EloParams }
// future: | { algorithm: 'glicko2'; params: Glicko2Params }

export interface RatingState {
  readonly rating: number
  readonly gamesPlayed: number
  /**
   * Elite-K hysteresis flag — present only under a config with eliteK enabled (absent = not
   * elite). Carried as state rather than derived from rating because a rating between exitAt
   * and enterAt is ambiguous: it depends on which side of the band the player came from. The
   * incremental path reads it back from rating_snapshots.is_elite_after, so it must be persisted.
   */
  readonly isElite?: boolean
}

export type RatingTable = ReadonlyMap<PlayerId, RatingState>

export interface MatchInput {
  readonly home: PlayerId
  readonly away: PlayerId
  readonly homeScore: number
  readonly awayScore: number
  /** Earlier meetings of this same pair within this match's session, from the effective log; absent = 0. */
  readonly priorSessionMeetings?: number
}

export interface ParticipantOutcome {
  readonly playerId: PlayerId
  readonly before: RatingState
  readonly after: RatingState
  readonly expectedScore: number // P(win) + 0.5 * P(draw) — for Elo, the logistic expectation
  readonly actualScore: 1 | 0.5 | 0
  readonly delta: number
  readonly wasProvisional: boolean
}

export interface MatchOutcome {
  readonly home: ParticipantOutcome
  readonly away: ParticipantOutcome
  readonly upset: boolean // winner had expectedScore < 0.5
}

export interface ReplayResult {
  readonly table: RatingTable
  readonly outcomes: readonly MatchOutcome[] // one per non-void match, in sequence order
}
