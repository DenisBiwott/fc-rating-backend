import { playerHasMatches } from '../infra/db/queries/matches.js'
import { deletePlayerRow, findPlayerById } from '../infra/db/queries/players.js'
import { PlayerHasMatchesError, PlayerNotFoundError } from './errors.js'
import type { Deps } from './types.js'

/**
 * Hard-deletes a player, but only if they've never appeared in a match — see
 * docs/ARCHITECTURE.md#domain-model and player-profile.ts's comment: players are otherwise never
 * deleted, only deactivated. A zero-match player has no history in the append-only match log to
 * preserve, so deleting them doesn't touch that invariant.
 */
export async function deletePlayer(deps: Deps, playerId: string): Promise<void> {
  const existing = await findPlayerById(deps.db, playerId)
  if (existing === undefined) throw new PlayerNotFoundError(playerId)

  if (await playerHasMatches(deps.db, playerId)) throw new PlayerHasMatchesError(playerId)

  await deletePlayerRow(deps.db, playerId)
}
