import type {
  MatchOutcome,
  ParticipantOutcome,
  PlayerId,
  RatingState,
} from '../domain/rating/types.js'
import type { SnapshotRow } from '../infra/db/queries/matches.js'

export interface MatchParticipants {
  homePlayerId: string
  awayPlayerId: string
}

/**
 * Rebuilds a MatchOutcome from persisted snapshot rows for one match, without recomputing
 * anything — used wherever outcome-shaped data is needed after the fact: recordMatch's
 * idempotent-retry path, and sessionSummary's per-match upset/delta accounting.
 * wasProvisional/upset aren't stored columns; both are cheap to derive from what is stored.
 * The elite flag isn't reconstructed: it's engine state for a player's *next* match (read back via
 * latestSnapshotsFor), not something any caller reads off an outcome.
 */
export function outcomeFromSnapshotRows(
  match: MatchParticipants,
  snapshots: readonly SnapshotRow[],
  provisionalGames: number,
): MatchOutcome {
  const byPlayer = new Map(snapshots.map((snapshot) => [snapshot.playerId, snapshot]))
  const homeSnapshot = byPlayer.get(match.homePlayerId)
  const awaySnapshot = byPlayer.get(match.awayPlayerId)
  if (homeSnapshot === undefined || awaySnapshot === undefined) {
    throw new Error('Missing rating snapshot(s) for match')
  }

  const toParticipant = (playerId: string, snapshot: SnapshotRow): ParticipantOutcome => {
    const before: RatingState = {
      rating: snapshot.ratingBefore,
      gamesPlayed: snapshot.gamesPlayedAfter - 1,
    }
    const after: RatingState = {
      rating: snapshot.ratingAfter,
      gamesPlayed: snapshot.gamesPlayedAfter,
    }
    return {
      playerId: playerId as PlayerId,
      before,
      after,
      expectedScore: snapshot.expectedScore,
      actualScore: snapshot.actualScore as 1 | 0.5 | 0,
      delta: snapshot.delta,
      wasProvisional: before.gamesPlayed < provisionalGames,
    }
  }

  const home = toParticipant(match.homePlayerId, homeSnapshot)
  const away = toParticipant(match.awayPlayerId, awaySnapshot)
  const winner = home.actualScore === 1 ? home : away.actualScore === 1 ? away : null
  const upset = winner !== null && winner.expectedScore < 0.5

  return { home, away, upset }
}
