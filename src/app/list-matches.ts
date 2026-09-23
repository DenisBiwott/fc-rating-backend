import type { MatchOutcome } from '../domain/rating/types.js'
import {
  listEffectiveMatches,
  type EffectiveMatchDetail,
} from '../infra/db/queries/match-effective.js'
import { snapshotsForMatches } from '../infra/db/queries/matches.js'
import { getActiveRatingConfig } from '../infra/db/queries/rating-configs.js'
import { outcomesByMatchId } from './reconstruct-outcome.js'
import type { Deps } from './types.js'

export interface ListMatchesInput {
  sessionId?: string
  playerId?: string
  includeVoided?: boolean
  cursor?: number
  limit?: number
}

export type ListedMatch = EffectiveMatchDetail & { outcome: MatchOutcome | null }

export interface ListMatchesResult {
  items: readonly ListedMatch[]
  nextCursor: number | null
}

const DEFAULT_LIMIT = 25

/**
 * Each item carries its outcome under the *active* config, same convention as matchDetail — null
 * for a voided match (excluded from every replay, so it has no snapshots). One batched snapshot
 * query per page, not one per match.
 */
export async function listMatches(
  deps: Deps,
  input: ListMatchesInput = {},
): Promise<ListMatchesResult> {
  const limit = input.limit ?? DEFAULT_LIMIT
  const rows = await listEffectiveMatches(deps.db, { ...input, limit })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? (page[page.length - 1]?.sequence ?? null) : null

  const { id: configId, config } = await getActiveRatingConfig(deps.db)
  const snapshots = await snapshotsForMatches(
    deps.db,
    configId,
    page.map((match) => match.id),
  )
  const outcomes = outcomesByMatchId(page, snapshots, config.params.provisionalGames)

  const items = page.map((match) => ({ ...match, outcome: outcomes.get(match.id) ?? null }))
  return { items, nextCursor }
}
