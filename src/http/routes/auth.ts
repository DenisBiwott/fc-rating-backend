import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { login } from '../../app/login.js'
import type { Deps } from '../../app/types.js'
import { clearSessionCookie, getSessionUser, setSessionCookie } from '../plugins/auth.js'
import { loginBodySchema, userEnvelopeSchema } from '../schemas/auth.js'
import { problemDetailsSchema } from '../schemas/common.js'

export function registerAuthRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/auth/login',
    { schema: { body: loginBodySchema, response: { 200: userEnvelopeSchema } } },
    async (request, reply) => {
      const user = await login(deps, { password: request.body.password })
      setSessionCookie(reply, { userId: user.id, name: user.name, role: user.role })
      return { user }
    },
  )

  typed.post('/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply)
    return reply.code(204).send()
  })

  typed.get(
    '/auth/me',
    { schema: { response: { 200: userEnvelopeSchema, 401: problemDetailsSchema } } },
    (request, reply) => {
      const session = getSessionUser(request)
      if (session === undefined) {
        void reply
          .code(401)
          .type('application/problem+json')
          .send({
            status: 401,
            instance: request.url,
            type: 'unauthorized',
            title: 'Unauthorized',
            detail: 'Not logged in.',
          })
        return
      }
      return { user: { id: session.userId, name: session.name, role: session.role } }
    },
  )
}
