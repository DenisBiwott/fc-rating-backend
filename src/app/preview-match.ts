import { previewMatch as domainPreviewMatch } from '../domain/rating/engine.js'
import type { MatchOutcome, PlayerId, RatingState } from '../domain/rating/types.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { latestSnapshotsFor } from '../infra/db/queries/ratings.js'
import { MatchValidationError } from './errors.js'
import type { Deps } from './types.js'

export interface PreviewMatchInput {
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
}

/** Same math as recordMatch, without writing anything — powers the record-match preview line. */
export async function previewMatch(deps: Deps, input: PreviewMatchInput): Promise<MatchOutcome> {
  if (input.homePlayerId === input.awayPlayerId) {
    throw new MatchValidationError('A match cannot be played against yourself.')
  }

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

  return domainPreviewMatch(
    table,
    { home: homeId, away: awayId, homeScore: input.homeScore, awayScore: input.awayScore },
    config,
  )
}
