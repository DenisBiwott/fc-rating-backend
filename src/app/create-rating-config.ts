import type { EloParams } from '../domain/rating/types.js'
import { isUniqueViolation } from '../infra/db/errors.js'
import { insertRatingConfig, type RatingConfigRow } from '../infra/db/queries/rating-configs.js'
import { RatingConfigNameConflictError } from './errors.js'
import type { Deps } from './types.js'

export interface CreateRatingConfigInput {
  name: string
  algorithm: 'elo'
  params: EloParams
}

/** New configs are inactive by default — see docs/API.md's route table (no activate endpoint at MVP). */
export async function createRatingConfig(
  deps: Deps,
  input: CreateRatingConfigInput,
): Promise<RatingConfigRow> {
  try {
    return await insertRatingConfig(deps.db, {
      id: deps.ids.newId(),
      name: input.name,
      algorithm: input.algorithm,
      params: input.params,
    })
  } catch (error) {
    if (isUniqueViolation(error, 'rating_configs_name_unique')) {
      throw new RatingConfigNameConflictError(input.name)
    }
    throw error
  }
}
