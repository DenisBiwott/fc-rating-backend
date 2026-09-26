import { renameSessionRow, type SessionRow } from '../infra/db/queries/sessions.js'
import { SessionNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export interface RenameSessionInput {
  sessionId: string
  name: string
}

/** Works on open and closed sessions alike — a name labels the session's table, not its state. */
export async function renameSession(deps: Deps, input: RenameSessionInput): Promise<SessionRow> {
  const renamed = await renameSessionRow(deps.db, input.sessionId, input.name)
  if (renamed === undefined) throw new SessionNotFoundError(input.sessionId)
  return renamed
}
