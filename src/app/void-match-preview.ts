import { toMatchInput } from '../domain/match/result.js'
import { replay } from '../domain/rating/engine.js'
import type { PlayerId } from '../domain/rating/types.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { findMatchById } from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { activePlayerRatings, allLatestSnapshots } from '../infra/db/queries/ratings.js'
import { MatchNotFoundError } from './errors.js'
import { diffAffectedPlayers, diffRanks, type RankChange } from './replay.js'
import type { Deps } from './types.js'

export interface VoidMatchPreviewPlayer {
  playerId: PlayerId
  ratingBefore: number
  gamesPlayedBefore: number
  ratingAfter: number
  gamesPlayedAfter: number
}

export interface VoidMatchPreviewResult {
  matchId: string
  players: readonly VoidMatchPreviewPlayer[]
  rankChanges: readonly RankChange[]
}

/**
 * Dry-run for voidMatch(): recomputes what ratings/ranks WOULD be if this match were voided,
 * without inserting an adjustment or persisting anything — no transaction, no advisory lock,
 * same shape as what-if-leaderboard.ts's pure replay. Simulates the void by excluding the match
 * from the effective log fed to replay(), rather than by inserting a real adjustment row.
 */
export async function previewVoidMatch(deps: Deps, matchId: string): Promise<VoidMatchPreviewResult> {
  const existing = await findMatchById(deps.db, matchId)
  if (existing === undefined) throw new MatchNotFoundError(matchId)

  const { id: configId, config } = await getActiveRatingConfig(deps.db)

  // All-time snapshot table (not just active players) — matches voidMatch()'s own "before" read,
  // so a deactivated player's rating change still gets reported.
  const beforeSnapshots = await allLatestSnapshots(deps.db, configId)
  // Active-only population, for ranking — leaderboard ranks are only ever computed over active
  // players (see leaderboard.ts/record-match.ts), so a meaningful rank diff must use the same set.
  const beforeActive = await activePlayerRatings(deps.db, configId, config.params.baseline)

  const effectiveMatches = (await allEffectiveMatches(deps.db)).filter(
    (match) => !match.isVoid && match.id !== matchId,
  )
  const { table: afterTable } = replay(effectiveMatches.map(toMatchInput), config)

  const affected = diffAffectedPlayers(beforeSnapshots, afterTable)
  const players: VoidMatchPreviewPlayer[] = affected.map((playerId) => ({
    playerId,
    ratingBefore: beforeSnapshots.get(playerId)?.rating ?? config.params.baseline,
    gamesPlayedBefore: beforeSnapshots.get(playerId)?.gamesPlayed ?? 0,
    ratingAfter: afterTable.get(playerId)?.rating ?? config.params.baseline,
    gamesPlayedAfter: afterTable.get(playerId)?.gamesPlayed ?? 0,
  }))

  const afterActive = beforeActive.map((player) => {
    const updated = afterTable.get(player.playerId)
    return updated
      ? { ...player, rating: updated.rating, gamesPlayed: updated.gamesPlayed }
      : { ...player, rating: config.params.baseline, gamesPlayed: 0 }
  })
  const rankChanges = diffRanks(beforeActive, afterActive)

  return { matchId, players, rankChanges }
}
