import type { EffectiveMatch, StoredAdjustment, StoredMatch } from './types.js'

function latestAdjustment(
  adjustments: readonly StoredAdjustment[],
  matchId: string,
): StoredAdjustment | undefined {
  return adjustments
    .filter((adjustment) => adjustment.matchId === matchId)
    .reduce<StoredAdjustment | undefined>(
      (latest, candidate) =>
        latest === undefined || candidate.sequence > latest.sequence ? candidate : latest,
      undefined,
    )
}

/**
 * Overlays each match with its latest adjustment, per fc-rating-backend/docs/ARCHITECTURE.md
 * #derive-by-replay. A void marks the match excluded from rating replay but the match still
 * appears in the returned list with isVoid: true — history is never deleted, only excluded from
 * the fold. Mirrors the match_effective SQL view used by non-replay read paths.
 */
export function effectiveMatches(
  matches: readonly StoredMatch[],
  adjustments: readonly StoredAdjustment[],
): readonly EffectiveMatch[] {
  return [...matches]
    .sort((a, b) => a.sequence - b.sequence)
    .map((match) => {
      const adjustment = latestAdjustment(adjustments, match.id)
      if (adjustment === undefined) {
        return { ...match, isVoid: false }
      }
      if (adjustment.type === 'void') {
        return { ...match, isVoid: true }
      }
      // adjustment.type === 'correct' here — CorrectAdjustment's fields are non-optional.
      return {
        id: match.id,
        sequence: match.sequence,
        homePlayerId: adjustment.newHomePlayerId,
        awayPlayerId: adjustment.newAwayPlayerId,
        homeScore: adjustment.newHomeScore,
        awayScore: adjustment.newAwayScore,
        sessionId: match.sessionId,
        isVoid: false,
      }
    })
}
