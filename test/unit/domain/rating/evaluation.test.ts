import { describe, expect, it } from 'vitest'
import {
  COIN_FLIP_SCORE,
  compareBrier,
  scorePredictions,
} from '../../../../src/domain/rating/evaluation.js'

describe('scorePredictions', () => {
  it('scores nothing as nothing, rather than as a perfect 0', () => {
    expect(scorePredictions([])).toEqual({ matches: 0, brier: null, logLoss: null })
  })

  it('always predicting 0.5 scores exactly the coin-flip bar, draws included', () => {
    const score = scorePredictions([
      { expectedScore: 0.5, actualScore: 1 },
      { expectedScore: 0.5, actualScore: 0 },
      { expectedScore: 0.5, actualScore: 0.5 },
    ])
    // A draw at 0.5 has zero squared error, so it pulls Brier below 0.25; log loss stays ln 2
    // for every 0.5 prediction whatever the result.
    expect(score.brier).toBeCloseTo((0.25 + 0.25 + 0) / 3, 12)
    expect(score.logLoss).toBeCloseTo(COIN_FLIP_SCORE.logLoss, 12)
  })

  it('hand-computed: a 0.75 favourite winning, and a 0.6 favourite drawing', () => {
    const score = scorePredictions([
      { expectedScore: 0.75, actualScore: 1 }, // (0.25)² = 0.0625;  −ln 0.75 ≈ 0.2877
      { expectedScore: 0.6, actualScore: 0.5 }, // (0.1)² = 0.01;  −(½ ln 0.6 + ½ ln 0.4) ≈ 0.7136
    ])
    expect(score.matches).toBe(2)
    expect(score.brier).toBeCloseTo((0.0625 + 0.01) / 2, 12)
    expect(score.logLoss).toBeCloseTo(
      (-Math.log(0.75) - (0.5 * Math.log(0.6) + 0.5 * Math.log(0.4))) / 2,
      12,
    )
  })

  it('punishes a confident miss far harder in log loss than in Brier', () => {
    const miss = scorePredictions([{ expectedScore: 0.99, actualScore: 0 }])
    expect(miss.brier).toBeCloseTo(0.9801, 12) // bounded by 1
    expect(miss.logLoss).toBeCloseTo(-Math.log(0.01), 12) // ≈ 4.6, unbounded as E → 1
  })

  it('stays finite when an expectation rounds to exactly 0 or 1', () => {
    const score = scorePredictions([{ expectedScore: 1, actualScore: 0 }])
    expect(Number.isFinite(score.logLoss)).toBe(true)
  })
})

describe('compareBrier', () => {
  const win = (expectedScore: number) => ({ expectedScore, actualScore: 1 as const })

  it('hand-computed: squared errors 0.04/0.09/0.01 against 0.09/0.16/0.04', () => {
    const comparison = compareBrier([win(0.8), win(0.7), win(0.9)], [win(0.7), win(0.6), win(0.8)])
    // Per-match differences −0.05, −0.07, −0.03: mean −0.05, sample sd 0.02, SE 0.02/√3.
    expect(comparison?.difference).toBeCloseTo(-0.05, 12)
    expect(comparison?.standardError).toBeCloseTo(0.02 / Math.sqrt(3), 12)
  })

  it('a config compared with itself differs by exactly 0', () => {
    const predictions = [win(0.8), { expectedScore: 0.4, actualScore: 0.5 as const }, win(0.3)]
    expect(compareBrier(predictions, predictions)).toEqual({ difference: 0, standardError: 0 })
  })

  it('needs at least two matches to estimate an error', () => {
    expect(compareBrier([win(0.8)], [win(0.7)])).toBeNull()
  })

  it('refuses lists that are not the same matches', () => {
    expect(() => compareBrier([win(0.8), win(0.7)], [win(0.8)])).toThrow()
    expect(() =>
      compareBrier([win(0.8), win(0.7)], [win(0.8), { expectedScore: 0.7, actualScore: 0 }]),
    ).toThrow()
  })
})
