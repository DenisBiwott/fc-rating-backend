import type { PlayerId } from '../rating/types.js'

export interface StoredMatch {
  readonly id: string
  readonly sequence: number
  readonly homePlayerId: PlayerId
  readonly awayPlayerId: PlayerId
  readonly homeScore: number
  readonly awayScore: number
}

export type AdjustmentType = 'void' | 'correct'

interface BaseAdjustment {
  readonly matchId: string
  readonly sequence: number // order among adjustments to the same match
}

export interface VoidAdjustment extends BaseAdjustment {
  readonly type: 'void'
}

// Replacement fields are required together, mirroring the adj_shape CHECK constraint in
// fc-rating-backend/docs/DATABASE.md — a 'correct' adjustment is never partial.
export interface CorrectAdjustment extends BaseAdjustment {
  readonly type: 'correct'
  readonly newHomePlayerId: PlayerId
  readonly newAwayPlayerId: PlayerId
  readonly newHomeScore: number
  readonly newAwayScore: number
}

export type StoredAdjustment = VoidAdjustment | CorrectAdjustment

export interface EffectiveMatch {
  readonly id: string
  readonly sequence: number
  readonly homePlayerId: PlayerId
  readonly awayPlayerId: PlayerId
  readonly homeScore: number
  readonly awayScore: number
  readonly isVoid: boolean
}

export type MatchResult = 'W' | 'L' | 'D'
