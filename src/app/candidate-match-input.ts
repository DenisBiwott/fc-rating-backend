import { toMatchInputs } from '../domain/match/result.js'
import type { MatchInput, PlayerId, RatingConfig } from '../domain/rating/types.js'
import { effectiveMatchesForSession } from '../infra/db/queries/match-effective.js'
import type { Queryable } from './types.js'

export interface CandidateMatch {
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
  sessionId?: string
}

/**
 * Engine input for one not-yet-recorded match (recordMatch, previewMatch). It will take the next
 * sequence, so every effective match already in its session came before it. Its meeting count is
 * computed by the same toMatchInputs fold a full replay runs, over that session's matches plus
 * this one, so the incremental path can't count differently from a rebuild. The session is only
 * read when the config actually damps repeat meetings.
 */
export async function candidateMatchInput(
  db: Queryable,
  config: RatingConfig,
  candidate: CandidateMatch,
): Promise<MatchInput> {
  const sessionId = candidate.sessionId ?? null
  const needsSession =
    sessionId !== null && config.params.repeatOpponentDamping?.enabled === true
  const earlierInSession = needsSession ? await effectiveMatchesForSession(db, sessionId) : []

  const inputs = toMatchInputs([
    ...earlierInSession,
    {
      homePlayerId: candidate.homePlayerId as PlayerId,
      awayPlayerId: candidate.awayPlayerId as PlayerId,
      homeScore: candidate.homeScore,
      awayScore: candidate.awayScore,
      sessionId,
    },
  ])
  const input = inputs[inputs.length - 1]
  if (input === undefined) throw new Error('toMatchInputs returned no input for the candidate match')
  return input
}
