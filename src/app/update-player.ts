import { isUniqueViolation } from '../infra/db/errors.js'
import { findPlayerById, updatePlayerRow, type PlayerRow } from '../infra/db/queries/players.js'
import { PlayerNameConflictError, PlayerNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export interface UpdatePlayerInput {
  name?: string
  avatarUrl?: string | null
  isActive?: boolean
}

export async function updatePlayer(
  deps: Deps,
  playerId: string,
  input: UpdatePlayerInput,
): Promise<PlayerRow> {
  const existing = await findPlayerById(deps.db, playerId)
  if (existing === undefined) throw new PlayerNotFoundError(playerId)

  let updated: PlayerRow | undefined
  try {
    updated = await updatePlayerRow(deps.db, playerId, input)
  } catch (error) {
    if (isUniqueViolation(error, 'players_name_unique')) {
      throw new PlayerNameConflictError(input.name ?? existing.name)
    }
    throw error
  }
  if (updated === undefined) throw new PlayerNotFoundError(playerId) // unreachable: existence checked above
  return updated
}
