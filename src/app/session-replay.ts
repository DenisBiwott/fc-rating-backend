import { toMatchInputs } from '../domain/match/result.js'
import type { EffectiveMatch } from '../domain/match/types.js'
import { replay } from '../domain/rating/engine.js'
import type { MatchOutcome, RatingConfig, RatingTable } from '../domain/rating/types.js'
import { effectiveMatchesForSession } from '../infra/db/queries/match-effective.js'
import type { Queryable } from './types.js'

export interface SessionReplay {
  /** The session's non-void effective matches, in sequence order. */
  matches: readonly EffectiveMatch[]
  table: RatingTable
  /** One per match, aligned with `matches`. */
  outcomes: readonly MatchOutcome[]
}

/**
 * A session's own rating ladder: only its non-void matches, replayed from an empty table, so
 * everyone starts the session at the config's baseline whatever their all-time rating. The one
 * definition of "session scope" — leaderboard() and sessionSummary() both read it.
 *
 * Computed on every call and never persisted, unlike the all-time ladder's rating_snapshots: a
 * session is a few hundred matches at most, and there's then nothing to invalidate when a match is
 * voided or corrected or the active config changes.
 */
export async function replaySession(
  db: Queryable,
  sessionId: string,
  config: RatingConfig,
): Promise<SessionReplay> {
  const matches = await effectiveMatchesForSession(db, sessionId)
  const { table, outcomes } = replay(toMatchInputs(matches), config)
  return { matches, table, outcomes }
}
