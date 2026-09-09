import { findCurrentSession, type SessionRow } from '../infra/db/queries/sessions.js'
import type { Deps } from './types.js'

export async function currentSession(deps: Deps): Promise<SessionRow | undefined> {
  return findCurrentSession(deps.db)
}
