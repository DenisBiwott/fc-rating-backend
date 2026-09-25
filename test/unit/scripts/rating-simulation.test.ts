import { describe, expect, it } from 'vitest'
import { expectedScore } from '../../../src/domain/rating/elo.js'
import {
  makeLeague,
  poisson,
  seededRng,
  simulate,
  spearman,
  trueExpectedScore,
  type Candidate,
} from '../../../scripts/rating-simulation.js'
import { testEloParams } from '../domain/factories.js'

/**
 * The simulation's conclusions only mean something if its model says what its comments claim —
 * these pin those claims, and the verdict rule it borrows from `ratings:evaluate`.
 */

describe('trueExpectedScore (the goal model)', () => {
  it('gives equals exactly 0.5, and is symmetric: E(gap) + E(−gap) = 1', () => {
    expect(trueExpectedScore(0)).toBeCloseTo(0.5, 12)
    for (const gap of [50, 200, 700]) {
      expect(trueExpectedScore(gap) + trueExpectedScore(-gap)).toBeCloseTo(1, 12)
    }
  })

  it("tracks Elo's win curve to within 0.01 for gaps up to 400 — what keeps σ in Elo points", () => {
    for (let gap = 0; gap <= 400; gap += 25) {
      expect(Math.abs(trueExpectedScore(gap) - expectedScore(gap, 0))).toBeLessThan(0.01)
    }
  })
})

describe('sampling', () => {
  it('is reproducible: the same seed gives the same sequence', () => {
    const a = seededRng(7)
    const b = seededRng(7)
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b))
  })

  it('draws Poisson goals with mean λ', () => {
    const rng = seededRng(1)
    const draws = Array.from({ length: 20_000 }, () => poisson(rng, 2.5))
    expect(draws.reduce((sum, x) => sum + x, 0) / draws.length).toBeCloseTo(2.5, 1)
  })

  it('never pairs a player with themselves, and plays every requested match', () => {
    const league = makeLeague(seededRng(3), 4, 500, 150)
    expect(league.matches).toHaveLength(500)
    expect(league.truth).toHaveLength(500)
    expect(league.matches.every((match) => match.home !== match.away)).toBe(true)
  })
})

describe('spearman', () => {
  it('is 1 for the same order, −1 for the reverse, and ignores the scale', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBe(1)
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1)
    expect(spearman([1, 2, 3, 4], [1, 8, 27, 1000])).toBe(1)
  })
})

describe('simulate', () => {
  const baseline: Candidate = { name: 'baseline', params: testEloParams }
  const scenario = { players: 11, matches: 150, sigma: 150, leagues: 30, seed: 1 }

  it('is deterministic for the same scenario and seed', () => {
    expect(simulate(scenario, [baseline], 'baseline')).toEqual(
      simulate(scenario, [baseline], 'baseline'),
    )
  })

  it('reports middle-80% ranges that move with σ — what choosing σ from real data relies on', () => {
    const narrow = simulate({ ...scenario, sigma: 50 }, [baseline], 'baseline')
    const wide = simulate({ ...scenario, sigma: 300 }, [baseline], 'baseline')
    for (const result of [narrow, wide]) {
      expect(result.spreadRange[0]).toBeLessThanOrEqual(result.spread)
      expect(result.spreadRange[1]).toBeGreaterThanOrEqual(result.spread)
      expect(result.brierRange[0]).toBeLessThanOrEqual(result.brierRange[1])
    }
    // Wider true skills: the ratings spread further, and results become easier to predict.
    expect(wide.spreadRange[0]).toBeGreaterThan(narrow.spreadRange[1])
    expect(wide.brierRange[1]).toBeLessThan(narrow.brierRange[0])
  })

  it('draws ~18% of games between equals, as the goal model says', () => {
    const { drawRate } = simulate({ ...scenario, sigma: 0, matches: 400 }, [baseline], 'baseline')
    expect(drawRate).toBeGreaterThan(0.16)
    expect(drawRate).toBeLessThan(0.21)
  })

  it("calls a config identical to the baseline noise every time — the evaluator's 0 ± 0 case", () => {
    const twin: Candidate = { name: 'twin', params: testEloParams }
    const result = simulate(scenario, [baseline, twin], 'baseline')
    expect(result.candidates[1]).toMatchObject({
      noise: scenario.leagues,
      better: 0,
      worse: 0,
      wrongCalls: 0,
      trulyBetter: 0,
    })
  })

  it('catches a near-frozen config (K 2/1) as worse, and never calls it better', () => {
    const frozen: Candidate = {
      name: 'frozen',
      params: { ...testEloParams, kProvisional: 2, kEstablished: 1 },
    }
    const result = simulate(
      { ...scenario, sigma: 200, matches: 300 },
      [baseline, frozen],
      'baseline',
    )
    const row = result.candidates[1]
    expect(row?.better).toBe(0)
    expect(row?.worse).toBeGreaterThan(scenario.leagues * 0.8)
    expect(row?.wrongCalls).toBe(0)
  })
})
