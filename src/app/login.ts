import { verifyPassword } from '../infra/auth/password.js'
import { findAdminUser } from '../infra/db/queries/users.js'
import { InvalidCredentialsError } from './errors.js'
import type { Deps } from './types.js'

export interface LoginInput {
  password: string
}

export interface LoginResult {
  id: string
  name: string
  role: 'admin' | 'recorder' | 'viewer'
}

/**
 * Verifies the shared admin password. Deliberately returns no cookie/token — that's an HTTP
 * concern, set by the route handler after this succeeds, keeping app/ free of Fastify knowledge
 * per docs/ARCHITECTURE.md#layers.
 */
export async function login(deps: Deps, input: LoginInput): Promise<LoginResult> {
  const user = await findAdminUser(deps.db)
  if (user === undefined || user.passwordHash === null) throw new InvalidCredentialsError()

  const valid = await verifyPassword(input.password, user.passwordHash)
  if (!valid) throw new InvalidCredentialsError()

  return { id: user.id, name: user.name, role: user.role }
}
