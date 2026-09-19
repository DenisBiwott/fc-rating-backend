import { describe, expect, it } from 'vitest'
import {
  goalDifferenceMultiplier,
  repeatOpponentMultiplier,
} from '../../../../src/domain/rating/elo.js'
import { applyMatch, initialState } from '../../../../src/domain/rating/engine.js'
import type {
  EliteK,
  MatchOutcome,
  RatingConfig,
  RatingState,
} from '../../../../src/domain/rating/types.js'
import { configWith, playerId, stateTable } from '../factories.js'

/**
 * One golden per optional Elo feature. Expected values are written out as first-principles
 * arithmetic (K, E, the multiplier), never by calling the engine's own helpers, so a formula bug
 * can't hide behind the code it's checking. testConfig's brackets: K=40 provisional, K=24
 * established (>= 10 games), baseline 1200.
 */

const home = playerId('home')
const away = playerId('away')

const established = (rating: number, isElite?: boolean): RatingState =>
  isElite === undefined ? { rating, gamesPlayed: 10 } : { rating, gamesPlayed: 10, isElite }

function play(
  config: RatingConfig,
  homeState: RatingState,
  awayState: RatingState,
  [homeScore, awayScore]: readonly [number, number],
  priorSessionMeetings = 0,
): MatchOutcome {
  return applyMatch(
    stateTable([
      [home, homeState],
      [away, awayState],
    ]),
    { home, away, homeScore, awayScore, priorSessionMeetings },
    config,
  ).outcome
}

describe('expectationScale', () => {
  it('1200 vs 1400, established, home wins: scale 800 flattens E from 1/(1+10^0.5) to 1/(1+10^0.25)', () => {
    const at400 = play(configWith({}), established(1200), established(1400), [1, 0])
    const at800 = play(
      configWith({ expectationScale: 800 }),
      established(1200),
      established(1400),
      [1, 0],
    )

    expect(at400.home.expectedScore).toBeCloseTo(1 / (1 + 10 ** 0.5), 12)
    expect(at800.home.expectedScore).toBeCloseTo(1 / (1 + 10 ** 0.25), 12)
    expect(at800.home.delta).toBeCloseTo(24 * (1 - 1 / (1 + 10 ** 0.25)), 9) // ≈ 15.36
    expect(at800.away.delta).toBeCloseTo(-24 * (1 - 1 / (1 + 10 ** 0.25)), 9)
  })
})

describe('goalDifferenceFactor', () => {
  const gd = configWith({ goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 } })

  it('1-0 between equals scales both sides by 1 + ln(2)/2', () => {
    const outcome = play(gd, established(1200), established(1200), [1, 0])
    expect(outcome.home.delta).toBeCloseTo(24 * (1 + Math.LN2 / 2) * 0.5, 9) // ≈ 16.16
    expect(outcome.away.delta).toBeCloseTo(-24 * (1 + Math.LN2 / 2) * 0.5, 9)
  })

  it('3-0 hits the cap: 1 + ln(4)/2 ≈ 1.69 is capped to 1.5, so +18/-18', () => {
    const outcome = play(gd, established(1200), established(1200), [3, 0])
    expect(outcome.home.delta).toBeCloseTo(18, 9)
    expect(outcome.away.delta).toBeCloseTo(-18, 9)
  })

  it('a zero goal difference yields a multiplier of exactly 1.0', () => {
    expect(goalDifferenceMultiplier({ home, away, homeScore: 2, awayScore: 2 }, gd.params)).toBe(1)
    // …so a draw between unequal players moves them exactly as much as without the feature.
    const withGd = play(gd, established(1250), established(1200), [2, 2])
    const without = play(configWith({}), established(1250), established(1200), [2, 2])
    expect(withGd.home.delta).toBe(without.home.delta)
  })

  it('divisor and cap are honoured: 5-0 with divisor 1, cap 3 → 1 + ln(6)', () => {
    const wide = configWith({ goalDifferenceFactor: { enabled: true, divisor: 1, cap: 3 } })
    const outcome = play(wide, established(1200), established(1200), [0, 5])
    expect(outcome.away.delta).toBeCloseTo(24 * (1 + Math.log(6)) * 0.5, 9) // ≈ 33.50
  })
})

describe('eliteK', () => {
  const eliteK: EliteK = {
    enabled: true,
    enterAt: 1500,
    exitAt: 1450,
    k: 16,
    requireEstablished: true,
  }
  const elite = configWith({ eliteK })

  it('hysteresis: at the same in-band rating, an elite player uses k and a non-elite one the bracket K', () => {
    const wasElite = play(elite, established(1480, true), established(1480, false), [1, 0])
    const wasNot = play(elite, established(1480, false), established(1480, false), [1, 0])

    expect(wasElite.home.delta).toBeCloseTo(16 * 0.5, 9)
    expect(wasNot.home.delta).toBeCloseTo(24 * 0.5, 9)
    // Neither crossed a boundary: 1488 stays elite (>= exitAt), 1492 stays non-elite (< enterAt).
    expect(wasElite.home.after.isElite).toBe(true)
    expect(wasNot.home.after.isElite).toBe(false)
  })

  it('enters at >= enterAt: 1495 + 12 = 1507 becomes elite', () => {
    const outcome = play(elite, established(1495, false), established(1495, false), [1, 0])
    expect(outcome.home.after.rating).toBeCloseTo(1507, 9)
    expect(outcome.home.after.isElite).toBe(true)
  })

  it('stays elite inside the band: 1470 − 8 = 1462 is still >= exitAt', () => {
    const outcome = play(elite, established(1470, true), established(1470, false), [0, 1])
    expect(outcome.home.after.rating).toBeCloseTo(1462, 9)
    expect(outcome.home.after.isElite).toBe(true)
  })

  it('exits below exitAt: 1455 − 8 = 1447', () => {
    const outcome = play(elite, established(1455, true), established(1455, false), [0, 1])
    expect(outcome.home.after.rating).toBeCloseTo(1447, 9)
    expect(outcome.home.after.isElite).toBe(false)
  })

  it('requireEstablished: a provisional player is never elite, whatever their rating or carried flag', () => {
    const provisional = { rating: 1600, gamesPlayed: 3, isElite: true }
    const outcome = play(elite, provisional, established(1600, false), [1, 0])
    expect(outcome.home.delta).toBeCloseTo(40 * 0.5, 9) // bracket K, not k
    expect(outcome.home.after.isElite).toBe(false)
  })

  it('requireEstablished: becomes elite on the match that makes them established, if rated high enough', () => {
    const outcome = play(
      elite,
      { rating: 1600, gamesPlayed: 9, isElite: false },
      established(1600),
      [1, 0],
    )
    expect(outcome.home.after.gamesPlayed).toBe(10)
    expect(outcome.home.after.isElite).toBe(true)
  })

  it('without requireEstablished, a provisional player can be elite', () => {
    const open = configWith({ eliteK: { ...eliteK, requireEstablished: false } })
    const outcome = play(
      open,
      { rating: 1495, gamesPlayed: 0, isElite: false },
      established(1495),
      [1, 0],
    )
    expect(outcome.home.after.rating).toBeCloseTo(1515, 9) // provisional K=40
    expect(outcome.home.after.isElite).toBe(true)
  })

  it('initialState carries the flag, evaluated at the baseline', () => {
    expect(initialState(elite)).toEqual({ rating: 1200, gamesPlayed: 0, isElite: false })
    const lowBar = configWith({
      eliteK: { ...eliteK, enterAt: 1100, exitAt: 1000, requireEstablished: false },
    })
    expect(initialState(lowBar)).toEqual({ rating: 1200, gamesPlayed: 0, isElite: true })
  })
})

describe('repeatOpponentDamping', () => {
  const damped = configWith({
    repeatOpponentDamping: { enabled: true, threshold: 3, factor: 0.85, minMultiplier: 0.25 },
  })
  const deltaAtMeeting = (meeting: number) =>
    play(damped, established(1200), established(1200), [1, 0], meeting - 1).home.delta

  it('meetings 1-3 are undamped', () => {
    expect(deltaAtMeeting(1)).toBeCloseTo(12, 9)
    expect(deltaAtMeeting(3)).toBeCloseTo(12, 9)
  })

  it('meeting 4 is ×0.85, meeting 5 is ×0.85²', () => {
    expect(deltaAtMeeting(4)).toBeCloseTo(12 * 0.85, 9)
    expect(deltaAtMeeting(5)).toBeCloseTo(12 * 0.7225, 9)
  })

  it('meeting 20 bottoms out at minMultiplier: 0.85^17 ≈ 0.063 < 0.25', () => {
    expect(deltaAtMeeting(20)).toBeCloseTo(12 * 0.25, 9)
  })

  it('damps both players equally', () => {
    const outcome = play(damped, established(1200), established(1200), [1, 0], 4)
    expect(outcome.away.delta).toBeCloseTo(-outcome.home.delta, 12)
    expect(
      repeatOpponentMultiplier({ home, away, homeScore: 1, awayScore: 0 }, damped.params),
    ).toBe(1)
  })
})

describe('maxDelta', () => {
  it('clamps a raw ±20 (both provisional, K=40) to ±10', () => {
    const outcome = play(
      configWith({ maxDelta: 10 }),
      { rating: 1200, gamesPlayed: 0 },
      { rating: 1200, gamesPlayed: 0 },
      [1, 0],
    )
    expect(outcome.home.delta).toBeCloseTo(10, 9)
    expect(outcome.away.delta).toBeCloseTo(-10, 9)
  })

  it('leaves a delta under the limit alone', () => {
    const outcome = play(configWith({ maxDelta: 15 }), established(1200), established(1200), [1, 0])
    expect(outcome.home.delta).toBeCloseTo(12, 9)
  })
})

describe('ratingFloor', () => {
  const floored = configWith({ ratingFloor: 1000 })

  it('clamps the loser at the floor: 1005 − 12 would be 993, lands on 1000', () => {
    const outcome = play(floored, established(1005), established(1005), [1, 0])
    expect(outcome.away.after.rating).toBe(1000)
    expect(outcome.away.delta).toBeCloseTo(-5, 9)
    expect(outcome.home.delta).toBeCloseTo(12, 9)
  })

  it('a player already at the floor who loses stays there', () => {
    const outcome = play(floored, established(1000), established(1000), [1, 0])
    expect(outcome.away.after.rating).toBe(1000)
    expect(outcome.away.delta).toBe(0)
  })
})

describe('K resolution order', () => {
  it('elite override → GD → damping → delta → maxDelta → ratingFloor, all at once', () => {
    const everything = configWith({
      eliteK: { enabled: true, enterAt: 1500, exitAt: 1450, k: 16, requireEstablished: true },
      goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 },
      repeatOpponentDamping: { enabled: true, threshold: 3, factor: 0.85, minMultiplier: 0.25 },
      maxDelta: 10,
      ratingFloor: 1475,
    })
    // Meeting 5 (0.85² = 0.7225), 3-0 (GD capped at 1.5), equal ratings (S − E = 0.5).
    const outcome = play(everything, established(1480, true), established(1480, false), [3, 0], 4)

    // Home is elite: K = 16 (not 24) × 1.5 × 0.7225 = 17.34 → +8.67, under maxDelta.
    expect(outcome.home.delta).toBeCloseTo(16 * 1.5 * 0.7225 * 0.5, 9)
    // Away: K = 24 × 1.5 × 0.7225 = 26.01 → −13.005, clamped to −10 (1470), then floored at 1475
    // — both clamps bite, and the reported delta is the change actually applied.
    expect(outcome.away.after.rating).toBe(1475)
    expect(outcome.away.delta).toBeCloseTo(-5, 9)
  })
})
