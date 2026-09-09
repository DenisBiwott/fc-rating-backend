import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export type Role = 'admin' | 'recorder' | 'viewer'

export interface SessionUser {
  userId: string
  name: string
  role: Role
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionUser?: SessionUser
  }
}

const roleRank: Record<Role, number> = { viewer: 0, recorder: 1, admin: 2 }

const COOKIE_NAME = 'fc_session'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function registerAuthDecorator(app: FastifyInstance): void {
  app.decorateRequest('sessionUser', undefined)
}

export function setSessionCookie(reply: FastifyReply, user: SessionUser): void {
  reply.setCookie(COOKIE_NAME, JSON.stringify(user), {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' })
}

function isSessionUser(value: unknown): value is SessionUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'userId' in value &&
    typeof value.userId === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'role' in value &&
    (value.role === 'admin' || value.role === 'recorder' || value.role === 'viewer')
  )
}

/** Reads and verifies the signed session cookie. Returns undefined if absent, tampered, or malformed. */
export function getSessionUser(request: FastifyRequest): SessionUser | undefined {
  const raw = request.cookies[COOKIE_NAME]
  if (raw === undefined) return undefined

  const unsigned = request.unsignCookie(raw)
  if (!unsigned.valid) return undefined

  try {
    const parsed: unknown = JSON.parse(unsigned.value)
    return isSessionUser(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function sendAuthProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  status: 401 | 403,
  detail: string,
): void {
  void reply
    .code(status)
    .type('application/problem+json')
    .send({
      status,
      instance: request.url,
      type: status === 401 ? 'unauthorized' : 'forbidden',
      title: status === 401 ? 'Unauthorized' : 'Forbidden',
      detail,
    })
}

/** For handlers behind requireRole(...) that need to know who's acting (recordedBy, adjustedBy, createdBy). Throws if the preHandler wasn't applied to this route — a wiring bug, not a runtime possibility. */
export function sessionUserOrThrow(request: FastifyRequest): SessionUser {
  if (request.sessionUser === undefined) {
    throw new Error('sessionUserOrThrow: no session on request — is requireRole() missing from this route?')
  }
  return request.sessionUser
}

/**
 * Role preHandler factory — admin > recorder > viewer, per CLAUDE.md#auth (a small ordinal check,
 * not a permissions library). 401 when there's no valid session, 403 when there is one but it's
 * under-ranked. Stashes the session on request.sessionUser for handlers that need to know who's
 * acting (recordedBy, adjustedBy, createdBy).
 */
/**
 * The returned preHandler must be async (or otherwise return a thenable) — Fastify's hook runner
 * only advances the chain by awaiting a returned promise or invoking the hook's `done` callback.
 * A plain synchronous function that returns void does neither, so the chain silently stalls: the
 * 401/403 branches "work" only by accident, because reply.send() finishes the HTTP response
 * directly regardless of the hook chain, but the success path (falling through to the route
 * handler) would hang forever without this.
 */
export function requireRole(minRole: Role) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getSessionUser(request)
    if (user === undefined) {
      sendAuthProblem(reply, request, 401, 'Login required.')
      return
    }
    if (roleRank[user.role] < roleRank[minRole]) {
      sendAuthProblem(reply, request, 403, `Requires ${minRole} role or higher.`)
      return
    }
    request.sessionUser = user
  }
}
