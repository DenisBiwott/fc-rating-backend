import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { postgresTypes } from './connection-options.js'
import * as schema from './schema.js'

export function createDbClient(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, { types: postgresTypes })
  return drizzle(queryClient, { schema })
}

export type Db = ReturnType<typeof createDbClient>
