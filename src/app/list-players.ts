import { lastPlayedAtByPlayer } from '../infra/db/queries/match-effective.js'
import { listPlayers as listPlayerRows, type PlayerRow } from '../infra/db/queries/players.js'
import type { Deps } from './types.js'

export interface ListPlayersInput {
  active?: boolean
}

export type ListedPlayer = PlayerRow & { lastPlayedAt: Date | null }

export async function listPlayers(
  deps: Deps,
  input: ListPlayersInput = {},
): Promise<ListedPlayer[]> {
  const [players, lastPlayedAt] = await Promise.all([
    listPlayerRows(deps.db, input),
    lastPlayedAtByPlayer(deps.db),
  ])
  return players.map((player) => ({
    ...player,
    lastPlayedAt: lastPlayedAt.get(player.id) ?? null,
  }))
}
