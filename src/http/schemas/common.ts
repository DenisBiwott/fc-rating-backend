import { z } from 'zod'

/**
 * RFC 9457 Problem Details — attached as an explicit response-schema entry (alongside the 200
 * schema) on any route whose handler sends a non-2xx status itself (auth's 401s, mainly), so
 * fastify-type-provider-zod's per-status `reply.code(n).send(...)` typing accepts it. Routes that
 * only ever throw (letting the error-handler plugin map the error) don't need this — the error
 * handler bypasses response-schema typing entirely.
 */
export const problemDetailsSchema = z.looseObject({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  instance: z.string().optional(),
})
