import { compareBrier, replay, scorePredictions } from '../src/domain/rating/index.js'
import type { EloParams, MatchInput, PlayerId, Prediction } from '../src/domain/rating/index.js'

/**
 * The simulation behind `pnpm ratings:simulate` (simulate-rating-configs.ts is only its CLI):
 * leagues where — unlike real life — every match's true win probability is known, replayed
 * through each candidate with the real engine and judged by the evaluator's own verdict rule.
 * Pure computation, no side effects on import. Why it exists: docs/RATING_CONFIGS.md.
 */

// --- goal model ----------------------------------------------------------------------------------
// Each side scores Poisson(BASE_GOALS · e^(±gap / GAP_SCALE)), where gap is the difference in true
// skill. It is deliberately NOT the Elo logistic, so the engine is misspecified the way it is in
// real life, but GAP_SCALE is fitted (least squares over gaps 0–400) so that its win curve tracks
// Elo's to within 0.01 up to a 400-point gap. That keeps sigma in Elo points: σ 150 means true
// skills spread like ratings with a standard deviation of 150. Between equals it draws ~18%.

const BASE_GOALS = 2.5
const GAP_SCALE = 635
const MAX_GOALS = 40 // truncates the exact sums; the mass above this is negligible for any gap here

function goalRates(gap: number): readonly [number, number] {
  return [BASE_GOALS * Math.exp(gap / GAP_SCALE), BASE_GOALS * Math.exp(-gap / GAP_SCALE)]
}

function poissonPmf(lambda: number): number[] {
  const pmf = [Math.exp(-lambda)]
  for (let k = 1; k <= MAX_GOALS; k++) pmf.push(at(pmf, k - 1) * (lambda / k))
  return pmf
}

/** The true P(win) + ½·P(draw) of the side `gap` points stronger — what a perfect config would predict. */
export function trueExpectedScore(gap: number): number {
  const [homeRate, awayRate] = goalRates(gap)
  const away = poissonPmf(awayRate)
  let expected = 0
  for (const [h, ph] of poissonPmf(homeRate).entries())
    for (const [a, pa] of away.entries()) expected += ph * pa * (h > a ? 1 : h === a ? 0.5 : 0)
  return expected
}

// --- seeded randomness -----------------------------------------------------------------------------

export type Rng = () => number

/** mulberry32: tiny, fast and seedable, so the same arguments always print the same table. */
export function seededRng(seed: number): Rng {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller: a standard normal draw from two uniforms. */
function normal(rng: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
}

/** Knuth's method: count uniforms until their product drops below e^−λ. Fine for small rates. */
export function poisson(rng: Rng, lambda: number): number {
  const limit = Math.exp(-lambda)
  let goals = -1
  let product = 1
  do {
    goals++
    product *= rng()
  } while (product > limit)
  return goals
}

// --- league generator ------------------------------------------------------------------------------

interface SimPlayer {
  readonly id: PlayerId
  readonly skill: number
  readonly activity: number // relative chance of being picked for a match
}

export interface League {
  readonly players: readonly SimPlayer[]
  readonly matches: readonly MatchInput[]
  readonly truth: readonly number[] // the home side's true expected score, per match
}

function at<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`index ${String(index)} out of range`)
  return item
}

export function makeLeague(
  rng: Rng,
  playerCount: number,
  matchCount: number,
  sigma: number,
): League {
  const players: SimPlayer[] = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${String(i)}` as PlayerId,
    skill: sigma * normal(rng),
    // Log-normal activity: like a real group, a few people play far more often than the rest.
    activity: Math.exp(0.6 * normal(rng)),
  }))
  const totalActivity = players.reduce((sum, player) => sum + player.activity, 0)
  const pick = (): SimPlayer => {
    let remaining = rng() * totalActivity
    for (const player of players) {
      remaining -= player.activity
      if (remaining < 0) return player
    }
    return at(players, players.length - 1)
  }

  const matches: MatchInput[] = []
  const truth: number[] = []
  for (let m = 0; m < matchCount; m++) {
    const home = pick()
    let away = pick()
    while (away === home) away = pick()
    const gap = home.skill - away.skill
    const [homeRate, awayRate] = goalRates(gap)
    matches.push({
      home: home.id,
      away: away.id,
      homeScore: poisson(rng, homeRate),
      awayScore: poisson(rng, awayRate),
    })
    truth.push(trueExpectedScore(gap))
  }
  return { players, matches, truth }
}

// --- measures --------------------------------------------------------------------------------------

/** Spearman's ρ: 1 when two lists put things in the same order, −1 when reversed, ~0 when unrelated. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const ranks = (values: readonly number[]) => {
    const order = [...values.keys()].sort((i, j) => at(values, i) - at(values, j))
    const result = new Array<number>(values.length).fill(0)
    order.forEach((index, rank) => {
      result[index] = rank
    })
    return result
  }
  const rx = ranks(xs)
  const ry = ranks(ys)
  const n = xs.length
  const squaredRankGaps = rx.reduce((sum, r, i) => sum + (r - at(ry, i)) ** 2, 0)
  return 1 - (6 * squaredRankGaps) / (n * (n * n - 1))
}

/** Mean squared distance from the TRUE expected scores — the quality the evaluator can only estimate. */
function errorVsTruth(predictions: readonly Prediction[], truth: readonly number[]): number {
  const total = predictions.reduce((sum, p, i) => sum + (p.expectedScore - at(truth, i)) ** 2, 0)
  return total / predictions.length
}

// --- the experiment --------------------------------------------------------------------------------

export interface Candidate {
  readonly name: string
  readonly params: EloParams
}

export interface Scenario {
  readonly players: number
  readonly matches: number
  readonly sigma: number
  readonly leagues: number
  readonly seed: number
}

export interface CandidateResult {
  readonly name: string
  /** Mean Brier over the leagues — what `ratings:evaluate` would print, on average. */
  readonly brier: number
  /** Mean Spearman ρ between final ratings and true skills: how right the leaderboard ORDER is. */
  readonly rankRho: number
  // Counts of leagues. better/noise/worse is the evaluator's verdict against the baseline.
  readonly better: number
  readonly noise: number
  readonly worse: number
  /** A better/worse verdict pointing the opposite way from the truth. */
  readonly wrongCalls: number
  /** This candidate's predictions really were closer to the true probabilities than the baseline's. */
  readonly trulyBetter: number
}

/** The 10th and 90th percentiles across the simulated leagues: where the middle 80% landed. */
export type Middle80 = readonly [low: number, high: number]

export interface ScenarioResult {
  readonly drawRate: number
  /**
   * Top-minus-bottom rating under the baseline at the end, and the baseline's Brier. The two
   * numbers to match against the real leaderboard and `ratings:evaluate` when choosing σ; the
   * ranges matter more than the means, because the real league is one draw, not an average.
   */
  readonly spread: number
  readonly spreadRange: Middle80
  readonly brierRange: Middle80
  /** Mean number of matches where both players were past provisional. */
  readonly established: number
  readonly candidates: readonly CandidateResult[]
}

function middle80(values: readonly number[]): Middle80 {
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (p: number) => at(sorted, Math.floor(p * (sorted.length - 1)))
  return [percentile(0.1), percentile(0.9)]
}

export function simulate(
  scenario: Scenario,
  candidates: readonly Candidate[],
  baselineName: string,
): ScenarioResult {
  if (scenario.matches < 2) throw new Error('a paired comparison needs at least 2 matches')
  const rng = seededRng(scenario.seed * 1_000_003 + scenario.matches * 7_919 + scenario.sigma)
  const tallies = candidates.map((candidate) => ({
    name: candidate.name,
    brier: 0,
    rankRho: 0,
    better: 0,
    noise: 0,
    worse: 0,
    wrongCalls: 0,
    trulyBetter: 0,
  }))
  let draws = 0
  let established = 0
  const spreads: number[] = []
  const baselineBriers: number[] = []

  for (let l = 0; l < scenario.leagues; l++) {
    const league = makeLeague(rng, scenario.players, scenario.matches, scenario.sigma)
    draws += league.matches.filter((m) => m.homeScore === m.awayScore).length / scenario.matches

    const runs = candidates.map((candidate) => {
      const result = replay(league.matches, { algorithm: 'elo', params: candidate.params })
      const predictions = result.outcomes.map((outcome) => outcome.home)
      return {
        name: candidate.name,
        result,
        predictions,
        error: errorVsTruth(predictions, league.truth),
      }
    })
    const baseline = runs.find((run) => run.name === baselineName)
    if (baseline === undefined) throw new Error(`no candidate named ${baselineName}`)

    const baselineRatings = [...baseline.result.table.values()].map((state) => state.rating)
    spreads.push(Math.max(...baselineRatings) - Math.min(...baselineRatings))
    baselineBriers.push(scorePredictions(baseline.predictions).brier ?? 0)
    established += baseline.result.outcomes.filter(
      (outcome) => !outcome.home.wasProvisional && !outcome.away.wasProvisional,
    ).length

    runs.forEach((run, i) => {
      const tally = at(tallies, i)
      tally.brier += scorePredictions(run.predictions).brier ?? 0
      const pairs = league.players.flatMap((player) => {
        const state = run.result.table.get(player.id)
        return state === undefined ? [] : [{ rating: state.rating, skill: player.skill }]
      })
      tally.rankRho += spearman(
        pairs.map((pair) => pair.rating),
        pairs.map((pair) => pair.skill),
      )
      if (run === baseline) return

      // The exact rule `pnpm ratings:evaluate` prints: `noise` within ±2 SE of zero.
      const comparison = compareBrier(run.predictions, baseline.predictions)
      if (comparison === null) throw new Error('a paired comparison needs at least 2 matches')
      const trulyBetter = run.error < baseline.error
      if (trulyBetter) tally.trulyBetter++
      if (Math.abs(comparison.difference) <= 2 * comparison.standardError) {
        tally.noise++
      } else if (comparison.difference < 0) {
        tally.better++
        if (!trulyBetter) tally.wrongCalls++
      } else {
        tally.worse++
        if (trulyBetter) tally.wrongCalls++
      }
    })
  }

  const n = scenario.leagues
  return {
    drawRate: draws / n,
    spread: spreads.reduce((sum, x) => sum + x, 0) / n,
    spreadRange: middle80(spreads),
    brierRange: middle80(baselineBriers),
    established: established / n,
    candidates: tallies.map((tally) => ({
      ...tally,
      brier: tally.brier / n,
      rankRho: tally.rankRho / n,
    })),
  }
}
