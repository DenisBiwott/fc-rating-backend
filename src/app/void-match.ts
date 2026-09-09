import { sql } from 'drizzle-orm'
import type { EffectiveMatch } from '../domain/match/types.js'
import type { PlayerId } from '../domain/rating/types.js'
import { insertAdjustment } from '../infra/db/queries/match-adjustments.js'
import { effectiveMatchById } from '../infra/db/queries/match-effective.js'
import { findMatchById } from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { allLatestSnapshots } from '../infra/db/queries/ratings.js'
import { MatchNotFoundError } from './errors.js'
import { diffAffectedPlayers, replayAndPersist } from './replay.js'
import type { Deps } from './types.js'

export interface VoidMatchInput {
  matchId: string
  reason: string
  adjustedBy: string
}

export interface VoidMatchResult {
  match: EffectiveMatch
  affectedPlayers: readonly PlayerId[]
}

/**
 * Marks a match void (never deletes it — match_adjustments is append-only) and replays the active
 * config's full effective match log under the same advisory lock, in the same transaction. See
 * docs/ARCHITECTURE.md#derive-by-replay for why "just replay everything" is the whole strategy.
 */
export async function voidMatch(deps: Deps, input: VoidMatchInput): Promise<VoidMatchResult> {
  const existing = await findMatchById(deps.db, input.matchId)
  if (existing === undefined) throw new MatchNotFoundError(input.matchId)

  return deps.db.transaction(async (tx) => {
    const { id: configId, config } = await getActiveRatingConfig(tx)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${configId}))`)

    const before = await allLatestSnapshots(tx, configId)

    await insertAdjustment(tx, {
      id: deps.ids.newId(),
      matchId: input.matchId,
      type: 'void',
      reason: input.reason,
      newHomePlayerId: null,
      newAwayPlayerId: null,
      newHomeScore: null,
      newAwayScore: null,
      adjustedBy: input.adjustedBy,
    })

    const { table: after } = await replayAndPersist(tx, configId, config)

    const effective = await effectiveMatchById(tx, input.matchId)
    if (effective === undefined) throw new MatchNotFoundError(input.matchId) // unreachable: just voided it

    return { match: effective, affectedPlayers: diffAffectedPlayers(before, after) }
  })
}
