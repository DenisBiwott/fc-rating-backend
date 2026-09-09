import {
  listRatingConfigs as listRatingConfigRows,
  type RatingConfigRow,
} from '../infra/db/queries/rating-configs.js'
import type { Deps } from './types.js'

export async function listRatingConfigs(deps: Deps): Promise<RatingConfigRow[]> {
  return listRatingConfigRows(deps.db)
}
