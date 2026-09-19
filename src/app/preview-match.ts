import { previewMatch as domainPreviewMatch } from '../domain/rating/engine.js'
import type { MatchOutcome, PlayerId, RatingState } from '../domain/rating/types.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { latestSnapshotsFor } from '../infra/db/queries/ratings.js'
import { candidateMatchInput } from './candidate-match-input.js'
import type { Deps } from './types.js'
import { validateMatchShape } from './validation.js'

export interface PreviewMatchInput {
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
  // Same meaning as on recordMatch: under a config with repeat-opponent damping, the preview only
  // matches what recording would produce if it's told the same session.
  sessionId?: string
}

/** Same math as recordMatch, without writing anything — powers the record-match preview line. */
export async function previewMatch(deps: Deps, input: PreviewMatchInput): Promise<MatchOutcome> {
  validateMatchShape(input)

  const { id: configId, config } = await getActiveRatingConfig(deps.db)
  const homeId = input.homePlayerId as PlayerId
  const awayId = input.awayPlayerId as PlayerId
  const latest = await latestSnapshotsFor(deps.db, configId, [
    input.homePlayerId,
    input.awayPlayerId,
  ])

  const table = new Map<PlayerId, RatingState>()
  const homeRating = latest.get(homeId)
  const awayRating = latest.get(awayId)
  if (homeRating !== undefined) table.set(homeId, homeRating)
  if (awayRating !== undefined) table.set(awayId, awayRating)

  return domainPreviewMatch(table, await candidateMatchInput(deps.db, config, input), config)
}
