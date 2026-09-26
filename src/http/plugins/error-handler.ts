import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod'
import {
  InvalidCredentialsError,
  MatchAlreadyVoidError,
  MatchNotFoundError,
  MatchValidationError,
  PlayerHasMatchesError,
  PlayerNameConflictError,
  PlayerNotFoundError,
  RateLimitExceededError,
  RatingConfigNameConflictError,
  SessionAlreadyClosedError,
  SessionAlreadyOpenError,
  SessionNotFoundError,
} from '../../app/errors.js'
import { NoActiveRatingConfigError, RatingConfigNotFoundError } from '../../infra/db/queries/rating-configs.js'

interface ProblemMapping {
  status: number
  type: string
  title: string
}

/**
 * Maps the typed error classes use-cases already throw to RFC 9457 Problem Details. Route
 * handlers never try/catch these — they just call a use-case and let the error propagate; this is
 * the one place status codes get decided. Extend this list as new use-cases add error classes
 * (players, rating-configs) in later slices, rather than handling errors per-route.
 */
const errorMappings: readonly [test: (error: unknown) => boolean, mapping: ProblemMapping][] = [
  [(e) => e instanceof MatchNotFoundError, { status: 404, type: 'not-found', title: 'Not Found' }],
  [(e) => e instanceof PlayerNotFoundError, { status: 404, type: 'not-found', title: 'Not Found' }],
  [(e) => e instanceof SessionNotFoundError, { status: 404, type: 'not-found', title: 'Not Found' }],
  [
    (e) => e instanceof RatingConfigNotFoundError,
    { status: 404, type: 'not-found', title: 'Not Found' },
  ],
  [
    (e) => e instanceof MatchValidationError,
    { status: 422, type: 'validation-error', title: 'Unprocessable Entity' },
  ],
  [
    (e) => e instanceof MatchAlreadyVoidError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof SessionAlreadyClosedError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof SessionAlreadyOpenError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof InvalidCredentialsError,
    { status: 401, type: 'unauthorized', title: 'Unauthorized' },
  ],
  [
    (e) => e instanceof PlayerNameConflictError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof PlayerHasMatchesError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof NoActiveRatingConfigError,
    { status: 500, type: 'internal-error', title: 'Internal Server Error' },
  ],
  [
    (e) => e instanceof RatingConfigNameConflictError,
    { status: 409, type: 'conflict', title: 'Conflict' },
  ],
  [
    (e) => e instanceof RateLimitExceededError,
    { status: 429, type: 'rate-limited', title: 'Too Many Requests' },
  ],
]

function sendProblem(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  body: { type: string; title: string; detail?: string; [key: string]: unknown },
): void {
  reply
    .code(status)
    .type('application/problem+json')
    .send({ status, instance: request.url, ...body })
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      sendProblem(reply, request, 400, {
        type: 'validation-error',
        title: 'Bad Request',
        detail: 'Request failed schema validation.',
        errors: error.validation,
      })
      return
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response failed to serialize')
      sendProblem(reply, request, 500, {
        type: 'internal-error',
        title: 'Internal Server Error',
      })
      return
    }

    const mapping = errorMappings.find(([test]) => test(error))?.[1]
    if (mapping !== undefined) {
      const message = error instanceof Error ? error.message : String(error)
      sendProblem(reply, request, mapping.status, {
        type: mapping.type,
        title: mapping.title,
        detail: message,
      })
      return
    }

    request.log.error({ err: error }, 'unhandled error')
    sendProblem(reply, request, 500, { type: 'internal-error', title: 'Internal Server Error' })
  })

  app.setNotFoundHandler((request, reply) => {
    sendProblem(reply, request, 404, {
      type: 'not-found',
      title: 'Not Found',
      detail: `No route matches ${request.method} ${request.url}.`,
    })
  })
}
