import { toMatchInputs } from '../domain/match/result.js'
import { replay } from '../domain/rating/engine.js'
import {
  compareBrier,
  scorePredictions,
  type BrierComparison,
  type PredictionScore,
} from '../domain/rating/evaluation.js'
import type { EloParams, MatchOutcome } from '../domain/rating/types.js'
import { allEffectiveMatches } from '../infra/db/queries/match-effective.js'
import { eloParamsSchema, listRatingConfigs } from '../infra/db/queries/rating-configs.js'
import type { Deps } from './types.js'

export interface CandidateConfig {
  name: string
  params: EloParams
}

export interface ConfigEvaluation {
  name: string
  source: 'active' | 'stored' | 'candidate'
  params: EloParams
  all: PredictionScore
  /** Only matches where both players had finished their provisional games — the steady state. */
  established: PredictionScore
  /** Paired against the active config over every match; null for the active config itself. */
  vsActive: BrierComparison | null
}

const homeSide = (outcomes: readonly MatchOutcome[]) => outcomes.map((outcome) => outcome.home)

/**
 * Scores how well every stored config, plus any candidates, would have predicted the results in
 * the effective match log — the what-if replay (what-if-leaderboard.ts) turned into a number.
 * Nothing is persisted, and the reads run in a READ ONLY transaction, so Postgres itself rejects
 * any write — safe to point at production. REPEATABLE READ gives every config the same log.
 * Ranked best first by Brier score over all matches.
 */
export async function evaluateRatingConfigs(
  deps: Deps,
  candidates: readonly CandidateConfig[],
): Promise<{ matchCount: number; evaluations: ConfigEvaluation[] }> {
  const { rows, effective } = await deps.db.transaction(
    async (tx) => ({
      rows: await listRatingConfigs(tx),
      effective: (await allEffectiveMatches(tx)).filter((match) => !match.isVoid),
    }),
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
  const inputs = toMatchInputs(effective)

  const configs = [
    ...rows.map((row) => ({
      name: row.name,
      source: row.isActive ? ('active' as const) : ('stored' as const),
      params: eloParamsSchema.parse(row.params),
    })),
    ...candidates.map((candidate) => ({ ...candidate, source: 'candidate' as const })),
  ]
  const replayed = configs.map((config) => ({
    ...config,
    outcomes: replay(inputs, { algorithm: 'elo', params: config.params }).outcomes,
  }))
  const active = replayed.find((config) => config.source === 'active')

  const evaluations = replayed.map(({ outcomes, ...config }): ConfigEvaluation => {
    const established = outcomes.filter(
      (outcome) => !outcome.home.wasProvisional && !outcome.away.wasProvisional,
    )
    return {
      ...config,
      all: scorePredictions(homeSide(outcomes)),
      established: scorePredictions(homeSide(established)),
      vsActive:
        active === undefined || config.source === 'active'
          ? null
          : compareBrier(homeSide(outcomes), homeSide(active.outcomes)),
    }
  })

  // With no matches every score is null; keep the original order rather than compare Infinity − Infinity.
  const rank = (evaluation: ConfigEvaluation) => evaluation.all.brier ?? Infinity
  return {
    matchCount: inputs.length,
    evaluations: evaluations.sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) - rank(b))),
  }
}
