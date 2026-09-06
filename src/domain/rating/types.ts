/**
 * Pure types for the rating engine. No imports outside this package — see
 * fc-rating-backend/docs/ARCHITECTURE.md#domain-model for the reasoning.
 */

export type PlayerId = string & { readonly __brand: 'PlayerId' }

export interface EloParams {
  readonly baseline: number // 1200
  readonly kProvisional: number // 40 — applied while gamesPlayed < provisionalGames
  readonly provisionalGames: number // 10
  readonly kEstablished: number // 24
  readonly drawScore: 0.5 // fixed; typed as literal so nobody "configures" it
}

export type RatingConfig = { readonly algorithm: 'elo'; readonly params: EloParams }
// future: | { algorithm: 'glicko2'; params: Glicko2Params }

export interface RatingState {
  readonly rating: number
  readonly gamesPlayed: number
}

export type RatingTable = ReadonlyMap<PlayerId, RatingState>

export interface MatchInput {
  readonly home: PlayerId
  readonly away: PlayerId
  readonly homeScore: number
  readonly awayScore: number
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
