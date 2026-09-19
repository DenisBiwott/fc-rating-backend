import type { ParticipantOutcome } from './types.js'

export type Prediction = Pick<ParticipantOutcome, 'expectedScore' | 'actualScore'>

export interface PredictionScore {
  readonly matches: number
  /** Mean (expected − actual)². 0 is perfect; always predicting 0.5 scores 0.25. */
  readonly brier: number | null
  /** Mean cross-entropy. Punishes a confident miss far harder than Brier; always predicting 0.5 scores ln 2 ≈ 0.693. */
  readonly logLoss: number | null
}

/** What a model that always predicts 0.5 scores on either metric — the bar any config has to clear. */
export const COIN_FLIP_SCORE = { brier: 0.25, logLoss: Math.LN2 } as const

// Keeps log(0) out of the mean when a huge rating gap drives an expectation to within float
// precision of 0 or 1.
const EPSILON = 1e-15

/**
 * How well a config's expectations predicted the results it replayed. Pass one side per match —
 * the home side, say: the away side mirrors it exactly (E' = 1 − E, S' = 1 − S), so scoring both
 * would only count every match twice. A draw's target is 0.5.
 */
export function scorePredictions(predictions: readonly Prediction[]): PredictionScore {
  if (predictions.length === 0) return { matches: 0, brier: null, logLoss: null }

  let squaredError = 0
  let crossEntropy = 0
  for (const { expectedScore, actualScore } of predictions) {
    const p = Math.min(Math.max(expectedScore, EPSILON), 1 - EPSILON)
    squaredError += (expectedScore - actualScore) ** 2
    crossEntropy -= actualScore * Math.log(p) + (1 - actualScore) * Math.log(1 - p)
  }

  return {
    matches: predictions.length,
    brier: squaredError / predictions.length,
    logLoss: crossEntropy / predictions.length,
  }
}

export interface BrierComparison {
  /** Mean per-match squared error, candidate minus baseline — negative means the candidate predicted better. */
  readonly difference: number
  readonly standardError: number
}

/**
 * Paired comparison of two configs' predictions over the SAME matches in the same order (two
 * replays of one effective log). Pairing cancels out how hard each individual match was to call,
 * so it can tell configs apart with far fewer matches than comparing two Brier scores side by
 * side. Rule of thumb: a difference within about two standard errors of zero is noise.
 */
export function compareBrier(
  candidate: readonly Prediction[],
  baseline: readonly Prediction[],
): BrierComparison | null {
  if (candidate.length !== baseline.length) {
    throw new Error('compareBrier needs predictions for the same matches, in the same order')
  }
  if (candidate.length < 2) return null

  const differences = candidate.map((ours, i) => {
    const theirs = baseline[i]
    if (theirs === undefined || theirs.actualScore !== ours.actualScore) {
      throw new Error(`compareBrier: match ${String(i)} has a different result in each list`)
    }
    return (
      (ours.expectedScore - ours.actualScore) ** 2 -
      (theirs.expectedScore - theirs.actualScore) ** 2
    )
  })

  const n = differences.length
  const mean = differences.reduce((sum, d) => sum + d, 0) / n
  const variance = differences.reduce((sum, d) => sum + (d - mean) ** 2, 0) / (n - 1)
  return { difference: mean, standardError: Math.sqrt(variance / n) }
}
