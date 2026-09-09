import { toMatchInput } from '../domain/match/result.js'
import { replay } from '../domain/rating/engine.js'
import type { PlayerId, RatingConfig, RatingTable } from '../domain/rating/types.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { insertSnapshots } from '../infra/db/queries/matches.js'
import { deleteSnapshotsForConfig } from '../infra/db/queries/ratings.js'
import { toSnapshotRow } from './snapshot-mapper.js'
import type { Transaction } from './types.js'

export interface ReplayResult {
  table: RatingTable
  matchCount: number
}

/**
 * Recomputes every rating_snapshots row for a config from scratch by replaying its full
 * effective match log, and persists the result — the "rebuild == incremental" guarantee from
 * docs/DATABASE.md#replay-and-rebuild. Used directly by rebuildConfig, and by voidMatch/
 * correctMatch right after writing their adjustment (same transaction, same lock — see
 * docs/ARCHITECTURE.md#concurrency-model). The caller must already hold the per-config advisory
 * lock; this function doesn't take it itself so an adjustment insert and the replay it triggers
 * stay atomic under one lock acquisition.
 */
export async function replayAndPersist(
  tx: Transaction,
  configId: string,
  config: RatingConfig,
): Promise<ReplayResult> {
  const effectiveMatches = (await allEffectiveMatches(tx)).filter((match) => !match.isVoid)

  await deleteSnapshotsForConfig(tx, configId)

  const { table, outcomes } = replay(effectiveMatches.map(toMatchInput), config)

  const rows = effectiveMatches.flatMap((match, index) => {
    const outcome = outcomes[index]
    // Invariant: replay() returns exactly one outcome per input match, in order.
    if (outcome === undefined) throw new Error(`replay() produced no outcome for match ${match.id}`)
    return [
      toSnapshotRow(configId, match, outcome.home),
      toSnapshotRow(configId, match, outcome.away),
    ]
  })
  if (rows.length > 0) await insertSnapshots(tx, rows)

  return { table, matchCount: effectiveMatches.length }
}

/** Players whose rating or gamesPlayed differs between two snapshots of the same config's rating table — the "affectedPlayers" a void/correct/rebuild reports. */
export function diffAffectedPlayers(
  before: ReadonlyMap<PlayerId, { rating: number; gamesPlayed: number }>,
  after: RatingTable,
): PlayerId[] {
  const allPlayerIds = new Set<PlayerId>([...before.keys(), ...after.keys()])
  const affected: PlayerId[] = []

  for (const playerId of allPlayerIds) {
    const beforeState = before.get(playerId)
    const afterState = after.get(playerId)
    const changed =
      (beforeState === undefined) !== (afterState === undefined) ||
      (beforeState !== undefined &&
        afterState !== undefined &&
        (Math.abs(beforeState.rating - afterState.rating) > 1e-9 ||
          beforeState.gamesPlayed !== afterState.gamesPlayed))
    if (changed) affected.push(playerId)
  }

  return affected
}
