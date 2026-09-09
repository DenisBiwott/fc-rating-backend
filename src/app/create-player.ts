import { isUniqueViolation } from '../infra/db/errors.js'
import { insertPlayer, type PlayerRow } from '../infra/db/queries/players.js'
import { PlayerNameConflictError } from './errors.js'
import type { Deps } from './types.js'

export interface CreatePlayerInput {
  name: string
  avatarUrl?: string
}

export async function createPlayer(deps: Deps, input: CreatePlayerInput): Promise<PlayerRow> {
  try {
    return await insertPlayer(deps.db, {
      id: deps.ids.newId(),
      name: input.name,
      avatarUrl: input.avatarUrl ?? null,
    })
  } catch (error) {
    if (isUniqueViolation(error, 'players_name_unique')) {
      throw new PlayerNameConflictError(input.name)
    }
    throw error
  }
}
