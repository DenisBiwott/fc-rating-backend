import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createPlayer } from '../../app/create-player.js'
import { deletePlayer } from '../../app/delete-player.js'
import { listPlayers } from '../../app/list-players.js'
import { playerMatches } from '../../app/player-matches.js'
import { playerProfile } from '../../app/player-profile.js'
import { ratingHistory } from '../../app/rating-history.js'
import type { Deps } from '../../app/types.js'
import { updatePlayer } from '../../app/update-player.js'
import type { PlayerRow } from '../../infra/db/queries/players.js'
import { omitUndefined } from '../omit-undefined.js'
import { requireRole } from '../plugins/auth.js'
import { paginationQuerySchema } from '../schemas/common.js'
import {
  createPlayerBodySchema,
  listPlayersQuerySchema,
  playerListResponseSchema,
  playerMatchesResponseSchema,
  playerParamsSchema,
  playerProfileResponseSchema,
  playerSchema,
  ratingHistoryResponseSchema,
  updatePlayerBodySchema,
} from '../schemas/player.js'

function toPlayerDto(row: PlayerRow) {
  return { id: row.id, name: row.name, avatarUrl: row.avatarUrl, isActive: row.isActive }
}

export function registerPlayerRoutes(app: FastifyInstance, deps: Deps): void {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/players',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['players'],
        operationId: 'createPlayer',
        summary: 'Create a player (requires admin role)',
        security: [{ sessionCookie: [] }],
        body: createPlayerBodySchema,
        response: { 201: playerSchema },
      },
    },
    async (request, reply) => {
      const player = await createPlayer(deps, omitUndefined(request.body))
      return reply.code(201).send(toPlayerDto(player))
    },
  )

  typed.get(
    '/players',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['players'],
        operationId: 'listPlayers',
        summary: 'List players',
        security: [{ sessionCookie: [] }],
        querystring: listPlayersQuerySchema,
        response: { 200: playerListResponseSchema },
      },
    },
    async (request) => {
      const players = await listPlayers(deps, omitUndefined(request.query))
      return players.map((player) => ({
        ...toPlayerDto(player),
        lastPlayedAt: player.lastPlayedAt?.toISOString() ?? null,
      }))
    },
  )

  typed.get(
    '/players/:id',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['players'],
        operationId: 'getPlayer',
        summary: 'Get a player profile',
        security: [{ sessionCookie: [] }],
        params: playerParamsSchema,
        response: { 200: playerProfileResponseSchema },
      },
    },
    async (request) => {
      const profile = await playerProfile(deps, request.params.id)
      return { ...profile, form: [...profile.form], createdAt: profile.createdAt.toISOString() }
    },
  )

  typed.patch(
    '/players/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['players'],
        operationId: 'updatePlayer',
        summary: 'Update a player (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: playerParamsSchema,
        body: updatePlayerBodySchema,
        response: { 200: playerSchema },
      },
    },
    async (request) => {
      const player = await updatePlayer(deps, request.params.id, omitUndefined(request.body))
      return toPlayerDto(player)
    },
  )

  typed.delete(
    '/players/:id',
    {
      preHandler: requireRole('admin'),
      schema: {
        tags: ['players'],
        operationId: 'deletePlayer',
        summary: 'Delete a player who has never played a match (requires admin role)',
        security: [{ sessionCookie: [] }],
        params: playerParamsSchema,
      },
    },
    async (request, reply) => {
      await deletePlayer(deps, request.params.id)
      return reply.code(204).send()
    },
  )

  typed.get(
    '/players/:id/rating-history',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['players'],
        operationId: 'getPlayerRatingHistory',
        summary: "Get a player's rating history",
        security: [{ sessionCookie: [] }],
        params: playerParamsSchema,
        response: { 200: ratingHistoryResponseSchema },
      },
    },
    async (request) => {
      const history = await ratingHistory(deps, request.params.id)
      return history.map((entry) => ({ ...entry, playedAt: entry.playedAt.toISOString() }))
    },
  )

  typed.get(
    '/players/:id/matches',
    {
      preHandler: requireRole('viewer'),
      schema: {
        tags: ['players'],
        operationId: 'listPlayerMatches',
        summary: "List a player's matches, cursor-paginated",
        security: [{ sessionCookie: [] }],
        params: playerParamsSchema,
        querystring: paginationQuerySchema,
        response: { 200: playerMatchesResponseSchema },
      },
    },
    async (request) => {
      const result = await playerMatches(
        deps,
        omitUndefined({
          playerId: request.params.id,
          cursor: request.query.cursor,
          limit: request.query.limit,
        }),
      )
      return { items: result.items.map((match) => ({ ...match })), nextCursor: result.nextCursor }
    },
  )
}
