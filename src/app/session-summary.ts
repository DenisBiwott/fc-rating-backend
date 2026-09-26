import type { PlayerId } from '../domain/rating/types.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { findSessionById } from '../infra/db/queries/sessions.js'
import { SessionNotFoundError } from './errors.js'
import { replaySession } from './session-replay.js'
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
 * Deltas/upsets come from the session's own ladder (replaySession, under the active config) — the
 * same ratings its leaderboard shows, so a player's delta is their session rating minus baseline.
 * Nothing is stored per session, so a later void/correct or config change is reflected
 * automatically.
 */
export async function sessionSummary(deps: Deps, sessionId: string): Promise<SessionSummaryResult> {
  const session = await findSessionById(deps.db, sessionId)
  if (session === undefined) throw new SessionNotFoundError(sessionId)

  const { config } = await getActiveRatingConfig(deps.db)
  const { matches, outcomes } = await replaySession(deps.db, sessionId, config)

  const deltaByPlayer = new Map<PlayerId, number>()
  let upsetCount = 0

  for (const outcome of outcomes) {
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
