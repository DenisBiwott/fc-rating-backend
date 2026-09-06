import type { MatchResult } from '../match/types.js'
import type { PlayerId } from '../rating/types.js'

export interface RatedPlayer {
  readonly playerId: PlayerId
  readonly rating: number
  readonly gamesPlayed: number
}

export interface RankedPlayer extends RatedPlayer {
  readonly rank: number
}

export interface PlayerMatchRecord {
  readonly sequence: number
  readonly result: MatchResult
}

export interface StreakInfo {
  readonly result: MatchResult
  readonly length: number
}
