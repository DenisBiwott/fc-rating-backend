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
 * idempotent-retry path, matchDetail, and (via outcomesByMatchId) sessionSummary and listMatches.
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

/**
 * outcomeFromSnapshotRows over many matches at once, from one batch of snapshot rows. A match with
 * fewer than two snapshots under the queried config (voided, or recorded before a config change)
 * is absent from the result rather than guessed at. Every match recorded normally has exactly two.
 */
export function outcomesByMatchId(
  matches: readonly (MatchParticipants & { id: string })[],
  snapshots: readonly SnapshotRow[],
  provisionalGames: number,
): Map<string, MatchOutcome> {
  const snapshotsByMatch = new Map<string, SnapshotRow[]>()
  for (const snapshot of snapshots) {
    const forMatch = snapshotsByMatch.get(snapshot.matchId) ?? []
    forMatch.push(snapshot)
    snapshotsByMatch.set(snapshot.matchId, forMatch)
  }

  const outcomes = new Map<string, MatchOutcome>()
  for (const match of matches) {
    const matchSnapshots = snapshotsByMatch.get(match.id) ?? []
    if (matchSnapshots.length < 2) continue
    outcomes.set(match.id, outcomeFromSnapshotRows(match, matchSnapshots, provisionalGames))
  }
  return outcomes
}
