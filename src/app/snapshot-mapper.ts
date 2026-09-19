import type { NewSnapshotRow } from '../infra/db/queries/matches.js'
import type { ParticipantOutcome } from '../domain/rating/types.js'

/** Maps one side of a domain MatchOutcome to a rating_snapshots row. Shared by recordMatch (one match) and replayAndPersist (every match, on rebuild/void/correct). */
export function toSnapshotRow(
  configId: string,
  match: { id: string; sequence: number },
  participant: ParticipantOutcome,
): NewSnapshotRow {
  return {
    configId,
    matchId: match.id,
    matchSequence: match.sequence,
    playerId: participant.playerId,
    ratingBefore: participant.before.rating,
    ratingAfter: participant.after.rating,
    expectedScore: participant.expectedScore,
    actualScore: participant.actualScore,
    delta: participant.delta,
    gamesPlayedAfter: participant.after.gamesPlayed,
    isEliteAfter: participant.after.isElite ?? false,
  }
}
