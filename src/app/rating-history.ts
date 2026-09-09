import { findPlayerById } from '../infra/db/queries/players.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { ratingHistoryForPlayer, type RatingHistoryEntry } from '../infra/db/queries/ratings.js'
import { PlayerNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export type { RatingHistoryEntry } from '../infra/db/queries/ratings.js'

/** One player's rating trajectory for the active config, in match order — powers the profile sparkline. */
export async function ratingHistory(
  deps: Deps,
  playerId: string,
): Promise<readonly RatingHistoryEntry[]> {
  const player = await findPlayerById(deps.db, playerId)
  if (player === undefined) throw new PlayerNotFoundError(playerId)

  const { id: configId } = await getActiveRatingConfig(deps.db)
  return ratingHistoryForPlayer(deps.db, configId, playerId)
}
