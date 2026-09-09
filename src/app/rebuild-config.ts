import { sql } from 'drizzle-orm'
import { getRatingConfigById } from '../infra/db/queries/rating-configs.js'
import { replayAndPersist } from './replay.js'
import type { Deps } from './types.js'

export interface RebuildConfigResult {
  configId: string
  matchCount: number
}

/** Truncates and replays one config's rating_snapshots from scratch — admin-only maintenance op, but also the correctness oracle void/correct lean on (see docs/DATABASE.md#replay-and-rebuild). */
export async function rebuildConfig(deps: Deps, configId: string): Promise<RebuildConfigResult> {
  return deps.db.transaction(async (tx) => {
    const { config } = await getRatingConfigById(tx, configId)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${configId}))`)

    const { matchCount } = await replayAndPersist(tx, configId, config)
    return { configId, matchCount }
  })
}
