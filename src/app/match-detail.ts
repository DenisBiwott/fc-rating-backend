import type { MatchOutcome } from '../domain/rating/types.js'
import { adjustmentsForMatch, type AdjustmentRow } from '../infra/db/queries/match-adjustments.js'
import {
  effectiveMatchDetailById,
  type EffectiveMatchDetail,
} from '../infra/db/queries/match-effective.js'
import { snapshotsForMatch } from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { MatchNotFoundError } from './errors.js'
import { outcomeFromSnapshotRows } from './reconstruct-outcome.js'
import type { Deps } from './types.js'

export interface MatchDetailResult {
  match: EffectiveMatchDetail
  adjustments: readonly AdjustmentRow[]
  outcome: MatchOutcome | null
}

/**
 * Outcome is reconstructed under the *active* config, same convention as leaderboard/profile — a
 * voided match has no snapshots under any config (excluded from every replay) so outcome is null.
 */
export async function matchDetail(deps: Deps, matchId: string): Promise<MatchDetailResult> {
  const match = await effectiveMatchDetailById(deps.db, matchId)
  if (match === undefined) throw new MatchNotFoundError(matchId)

  const adjustments = await adjustmentsForMatch(deps.db, matchId)

  const { id: configId, config } = await getActiveRatingConfig(deps.db)
  const snapshots = await snapshotsForMatch(deps.db, configId, matchId)
  const outcome =
    snapshots.length < 2
      ? null
      : outcomeFromSnapshotRows(match, snapshots, config.params.provisionalGames)

  return { match, adjustments, outcome }
}
