import { listSessions as listSessionRows, type SessionRow } from '../infra/db/queries/sessions.js'
import type { Deps } from './types.js'

export async function listSessions(deps: Deps): Promise<SessionRow[]> {
  return listSessionRows(deps.db)
}
