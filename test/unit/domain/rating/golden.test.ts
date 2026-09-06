import { describe, expect, it } from 'vitest'
import { applyMatch } from '../../../../src/domain/rating/engine.js'
import { playerId, seededTable, testConfig } from '../factories.js'

describe('elo golden values', () => {
  it('1200 vs 1200, both established (K=24), home wins 1-0 -> +12/-12', () => {
    const home = playerId('home')
    const away = playerId('away')
    const table = seededTable([
      [home, 1200, 10],
      [away, 1200, 10],
    ])

    const { outcome } = applyMatch(table, { home, away, homeScore: 1, awayScore: 0 }, testConfig)

    expect(outcome.home.delta).toBeCloseTo(12, 9)
    expect(outcome.away.delta).toBeCloseTo(-12, 9)
    expect(outcome.home.after.rating).toBeCloseTo(1212, 9)
    expect(outcome.away.after.rating).toBeCloseTo(1188, 9)
    expect(outcome.home.wasProvisional).toBe(false)
    expect(outcome.upset).toBe(false)
  })

  it('1200 vs 1200, both provisional (K=40), home wins -> +20/-20, zero-sum within a bracket', () => {
    const home = playerId('home')
    const away = playerId('away')
    const table = seededTable([
      [home, 1200, 0],
      [away, 1200, 0],
    ])

    const { outcome } = applyMatch(table, { home, away, homeScore: 3, awayScore: 1 }, testConfig)

    expect(outcome.home.delta).toBeCloseTo(20, 9)
    expect(outcome.away.delta).toBeCloseTo(-20, 9)
    expect(outcome.home.wasProvisional).toBe(true)
    expect(outcome.away.wasProvisional).toBe(true)
  })

  it('asymmetric K (one provisional, one established) does not sum to zero — intentional', () => {
    const home = playerId('home') // provisional, K=40
    const away = playerId('away') // established, K=24
    const table = seededTable([
      [home, 1200, 0],
      [away, 1200, 10],
    ])

    const { outcome } = applyMatch(table, { home, away, homeScore: 1, awayScore: 0 }, testConfig)

    expect(outcome.home.delta).toBeCloseTo(20, 9)
    expect(outcome.away.delta).toBeCloseTo(-12, 9)
    expect(outcome.home.delta + outcome.away.delta).not.toBeCloseTo(0, 9)
  })

  it('flags an upset when the pre-match underdog wins', () => {
    const home = playerId('home')
    const away = playerId('away')
    const table = seededTable([
      [home, 1000, 10],
      [away, 1400, 10],
    ])

    const { outcome } = applyMatch(table, { home, away, homeScore: 1, awayScore: 0 }, testConfig)

    expect(outcome.home.expectedScore).toBeLessThan(0.5)
    expect(outcome.upset).toBe(true)
  })
})
