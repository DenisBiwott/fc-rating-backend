import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Clock } from '../infra/clock.js'
import type * as schema from '../infra/db/schema.js'
import type { Ids } from '../infra/ids.js'
import type { Logger } from '../infra/logger.js'

export type Database = PostgresJsDatabase<typeof schema>

/** The type of the `tx` a `db.transaction(async (tx) => ...)` callback receives. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Query modules accept either — same query-building API, so one function serves both call sites. */
export type Queryable = Database | Transaction

/**
 * Every use-case takes this instead of importing a global db/clock/ids/logger, per
 * fc-rating-backend/docs/ARCHITECTURE.md#layers — explicit dependencies, no DI container.
 */
export interface Deps {
  db: Database
  clock: Clock
  ids: Ids
  logger: Logger
}
