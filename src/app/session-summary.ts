import type { PlayerId } from '../domain/rating/types.js'
import { effectiveMatchesForSession } from '../infra/db/queries/match-effective.js'
import { snapshotsForMatches } from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { findSessionById } from '../infra/db/queries/sessions.js'
import { SessionNotFoundError } from './errors.js'
import { outcomesByMatchId } from './reconstruct-outcome.js'
import type { Deps } from './types.js'

export interface PlayerSessionDelta {
  playerId: PlayerId
  delta: number
}

export interface SessionSummaryResult {
  id: string
  name: string
  startedAt: Date
  endedAt: Date | null
  matchCount: number
  playerDeltas: readonly PlayerSessionDelta[]
  biggestMover: PlayerSessionDelta | null
  upsetCount: number
}

/**
 * Deltas/upsets are computed against the *current* active config, from the matches actually
 * played in this session — not stored per session, so they reflect any later void/correct/
 * rebuild automatically, same as the leaderboard.
 */
export async function sessionSummary(deps: Deps, sessionId: string): Promise<SessionSummaryResult> {
  const session = await findSessionById(deps.db, sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)

  const { id: configId, config } = await getActiveRatingConfig(deps.db)
  const matches = await effectiveMatchesForSession(deps.db, sessionId)
  const snapshots = await snapshotsForMatches(
    deps.db,
    configId,
    matches.map((match) => match.id),
  )

  // A match this session might not have snapshots under the *current* config if the config
  // changed since — outcomesByMatchId skips it rather than guessing.
  const outcomes = outcomesByMatchId(matches, snapshots, config.params.provisionalGames)

  const deltaByPlayer = new Map<PlayerId, number>()
  let upsetCount = 0

  for (const outcome of outcomes.values()) {
    if (outcome.upset) upsetCount += 1
    deltaByPlayer.set(
      outcome.home.playerId,
      (deltaByPlayer.get(outcome.home.playerId) ?? 0) + outcome.home.delta,
    )
    deltaByPlayer.set(
      outcome.away.playerId,
      (deltaByPlayer.get(outcome.away.playerId) ?? 0) + outcome.away.delta,
    )
  }

  const playerDeltas: PlayerSessionDelta[] = [...deltaByPlayer.entries()].map(
    ([playerId, delta]) => ({
      playerId,
      delta,
    }),
  )
  const biggestMover = playerDeltas.reduce<PlayerSessionDelta | null>(
    (best, current) =>
      best === null || Math.abs(current.delta) > Math.abs(best.delta) ? current : best,
    null,
  )

  return {
    id: session.id,
    name: session.name,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    matchCount: matches.length,
    playerDeltas,
    biggestMover,
    upsetCount,
  }
}
