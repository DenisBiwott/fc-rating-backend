import type { MatchResult } from '../match/types.js'
import type { PlayerMatchRecord, RankedPlayer, RatedPlayer, StreakInfo } from './types.js'

/**
 * Ranks by rating descending. Ties break on playerId so the ordering is deterministic —
 * two equal ratings must not silently reorder between two runs over the same input.
 */
export function rankPlayers(players: readonly RatedPlayer[]): readonly RankedPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating
    return a.playerId.localeCompare(b.playerId)
  })
  return sorted.map((player, index) => ({ ...player, rank: index + 1 }))
}

export function isProvisional(gamesPlayed: number, provisionalGames: number): boolean {
  return gamesPlayed < provisionalGames
}

/** Last `count` results in chronological order (oldest first) — matches FormStrip's left-to-right rendering. */
export function recentForm(
  records: readonly PlayerMatchRecord[],
  count = 5,
): readonly MatchResult[] {
  return [...records]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-count)
    .map((record) => record.result)
}

/** The streak ending at the most recent match; null if no matches have been played. */
export function currentStreak(records: readonly PlayerMatchRecord[]): StreakInfo | null {
  const sorted = [...records].sort((a, b) => b.sequence - a.sequence)
  const mostRecent = sorted[0]
  if (mostRecent === undefined) return null

  let length = 0
  for (const record of sorted) {
    if (record.result !== mostRecent.result) break
    length += 1
  }
  return { result: mostRecent.result, length }
}
