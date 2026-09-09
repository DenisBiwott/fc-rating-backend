import { closeSessionRow, findSessionById, type SessionRow } from '../infra/db/queries/sessions.js'
import { SessionAlreadyClosedError, SessionNotFoundError } from './errors.js'
import type { Deps } from './types.js'

export interface CloseSessionInput {
  sessionId: string
}

export async function closeSession(deps: Deps, input: CloseSessionInput): Promise<SessionRow> {
  const updated = await closeSessionRow(deps.db, input.sessionId, deps.clock.now())
  if (updated !== undefined) return updated

  // The guarded UPDATE affected no row — figure out which of the two reasons that was.
  const existing = await findSessionById(deps.db, input.sessionId)
  if (existing === undefined) throw new SessionNotFoundError(input.sessionId)
  throw new SessionAlreadyClosedError(input.sessionId)
}
