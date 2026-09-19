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

/** Goals scored by one player's side on an effective match. */
export function goalsFor(match: EffectiveMatch, playerId: PlayerId): number {
  return match.homePlayerId === playerId ? match.homeScore : match.awayScore
}

/** Goals conceded by one player's side on an effective match. */
export function goalsAgainst(match: EffectiveMatch, playerId: PlayerId): number {
  return match.homePlayerId === playerId ? match.awayScore : match.homeScore
}

/** What toMatchInputs reads — an EffectiveMatch satisfies it, and so does a not-yet-recorded match. */
export type ReplayableMatch = Pick<
  EffectiveMatch,
  'homePlayerId' | 'awayPlayerId' | 'homeScore' | 'awayScore' | 'sessionId'
>

function sessionPairKey(sessionId: string, a: PlayerId, b: PlayerId): string {
  return a < b ? `${sessionId}|${a}|${b}` : `${sessionId}|${b}|${a}`
}

/**
 * Converts ordered, non-void effective matches into rating-engine input, annotating each with
 * how many times the same pair (either way round) already met earlier in the same session —
 * repeat-opponent damping's input. The count is a fold, so it's only right over a whole ordered
 * log: the full effective log for a replay, or one session's prior matches plus the new one for
 * a single match (src/app/candidate-match-input.ts). A match with no session is never a repeat.
 */
export function toMatchInputs(matches: readonly ReplayableMatch[]): MatchInput[] {
  const meetings = new Map<string, number>()
  return matches.map((match) => {
    let priorSessionMeetings = 0
    if (match.sessionId !== null) {
      const key = sessionPairKey(match.sessionId, match.homePlayerId, match.awayPlayerId)
      priorSessionMeetings = meetings.get(key) ?? 0
      meetings.set(key, priorSessionMeetings + 1)
    }
    return {
      home: match.homePlayerId,
      away: match.awayPlayerId,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      priorSessionMeetings,
    }
  })
}
