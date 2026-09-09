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
import { validateMatchShape } from './validation.js'

export interface CorrectMatchInput {
  matchId: string
  reason: string
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
  adjustedBy: string
}

export interface CorrectMatchResult {
  match: EffectiveMatch
  affectedPlayers: readonly PlayerId[]
}

/**
 * Records a replacement result for a match (never edits the original row — match_adjustments is
 * append-only) and replays the active config's full effective match log under the same advisory
 * lock, in the same transaction.
 */
export async function correctMatch(
  deps: Deps,
  input: CorrectMatchInput,
): Promise<CorrectMatchResult> {
  validateMatchShape(input)

  const existing = await findMatchById(deps.db, input.matchId)
  if (existing === undefined) throw new MatchNotFoundError(input.matchId)

  return deps.db.transaction(async (tx) => {
    const { id: configId, config } = await getActiveRatingConfig(tx)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${configId}))`)

    const before = await allLatestSnapshots(tx, configId)

    await insertAdjustment(tx, {
      id: deps.ids.newId(),
      matchId: input.matchId,
      type: 'correct',
      reason: input.reason,
      newHomePlayerId: input.homePlayerId,
      newAwayPlayerId: input.awayPlayerId,
      newHomeScore: input.homeScore,
      newAwayScore: input.awayScore,
      adjustedBy: input.adjustedBy,
    })

    const { table: after } = await replayAndPersist(tx, configId, config)

    const effective = await effectiveMatchById(tx, input.matchId)
    if (effective === undefined) throw new MatchNotFoundError(input.matchId) // unreachable: just corrected it

    return { match: effective, affectedPlayers: diffAffectedPlayers(before, after) }
  })
}
