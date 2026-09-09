import { isUniqueViolation } from '../infra/db/errors.js'
import { insertSession, type SessionRow } from '../infra/db/queries/sessions.js'
import { SessionAlreadyOpenError } from './errors.js'
import type { Deps } from './types.js'

export interface OpenSessionInput {
  name: string
  createdBy: string
}

/** sessions_one_open (a partial unique index, not app logic) is what actually enforces "at most one open session" — this just translates its violation into a typed error. */
export async function openSession(deps: Deps, input: OpenSessionInput): Promise<SessionRow> {
  try {
    return await insertSession(deps.db, {
      id: deps.ids.newId(),
      name: input.name,
      startedAt: deps.clock.now(),
      createdBy: input.createdBy,
    })
  } catch (error) {
    if (isUniqueViolation(error, 'sessions_one_open')) throw new SessionAlreadyOpenError()
    throw error
  }
}
