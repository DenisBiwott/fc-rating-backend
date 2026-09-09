import { z } from 'zod'

export const loginBodySchema = z.object({ password: z.string().min(1) })

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'recorder', 'viewer']),
})

export const userEnvelopeSchema = z.object({ user: userSchema })
