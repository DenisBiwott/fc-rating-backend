import { listPlayers as listPlayerRows, type PlayerRow } from '../infra/db/queries/players.js'
import type { Deps } from './types.js'

export interface ListPlayersInput {
  active?: boolean
}

export async function listPlayers(deps: Deps, input: ListPlayersInput = {}): Promise<PlayerRow[]> {
  return listPlayerRows(deps.db, input)
}
