import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { expectedScore } from '../../../../src/domain/rating/elo.js'
import { applyMatch, replay } from '../../../../src/domain/rating/engine.js'
import type { MatchInput, ParticipantOutcome } from '../../../../src/domain/rating/types.js'
import { playerId, seededTable, testConfig } from '../factories.js'

/**
 * Forward and mirrored computations reach the same result via a different floating-point
 * evaluation order (10^(x/400) vs 10^(-x/400)), so exact deep-equality is too strict here —
 * only the numeric leaves need tolerance, everything else must match exactly.
 */
function expectParticipantClose(actual: ParticipantOutcome, expected: ParticipantOutcome): void {
  expect(actual.playerId).toBe(expected.playerId)
  expect(actual.before.gamesPlayed).toBe(expected.before.gamesPlayed)
  expect(actual.before.rating).toBeCloseTo(expected.before.rating, 9)
  expect(actual.after.gamesPlayed).toBe(expected.after.gamesPlayed)
  expect(actual.after.rating).toBeCloseTo(expected.after.rating, 9)
  expect(actual.actualScore).toBe(expected.actualScore)
  expect(actual.expectedScore).toBeCloseTo(expected.expectedScore, 9)
  expect(actual.delta).toBeCloseTo(expected.delta, 9)
  expect(actual.wasProvisional).toBe(expected.wasProvisional)
}

const rating = fc.double({ min: 0, max: 3000, noNaN: true })
const gamesPlayed = fc.integer({ min: 0, max: 60 })
const score = fc.integer({ min: 0, max: 10 })
const bracket = fc.constantFrom(0, 20) // 0 = provisional, 20 = established — same value for both sides

const home = playerId('home')
const away = playerId('away')

const matchScenario = fc.record({
  rHome: rating,
  rAway: rating,
  gpHome: gamesPlayed,
  gpAway: gamesPlayed,
  sHome: score,
  sAway: score,
})

describe('rating engine properties', () => {
  it('is symmetric: swapping home/away and scores mirrors the outcome', () => {
    fc.assert(
      fc.property(matchScenario, ({ rHome, rAway, gpHome, gpAway, sHome, sAway }) => {
        const forward = applyMatch(
          seededTable([
            [home, rHome, gpHome],
            [away, rAway, gpAway],
          ]),
          { home, away, homeScore: sHome, awayScore: sAway },
          testConfig,
        ).outcome

        const mirrored = applyMatch(
          seededTable([
            [away, rAway, gpAway],
            [home, rHome, gpHome],
          ]),
          { home: away, away: home, homeScore: sAway, awayScore: sHome },
          testConfig,
        ).outcome

        expectParticipantClose(forward.home, mirrored.away)
        expectParticipantClose(forward.away, mirrored.home)

        // forward's and mirrored's expectedScore for the same player agree only to ~1e-9 (see
        // expectParticipantClose above) because 10^(x/400) and 10^(-x/400) aren't exact floating
        // reciprocals. Within ~1e-9 of the 0.5 upset boundary that's enough to flip which side of
        // "< 0.5" a near-tie lands on — not an engine bug, just floating-point non-associativity,
        // so the upset comparison is undefined right at the razor's edge.
        const winnerExpected =
          forward.home.actualScore === 1
            ? forward.home.expectedScore
            : forward.away.actualScore === 1
              ? forward.away.expectedScore
              : undefined
        fc.pre(winnerExpected === undefined || Math.abs(winnerExpected - 0.5) > 1e-6)

        expect(forward.upset).toBe(mirrored.upset)
      }),
    )
  })

  it('is zero-sum when both players share a K bracket', () => {
    fc.assert(
      fc.property(
        fc.record({ rHome: rating, rAway: rating, gp: bracket, sHome: score, sAway: score }),
        ({ rHome, rAway, gp, sHome, sAway }) => {
          const { outcome } = applyMatch(
            seededTable([
              [home, rHome, gp],
              [away, rAway, gp],
            ]),
            { home, away, homeScore: sHome, awayScore: sAway },
            testConfig,
          )
          expect(outcome.home.delta + outcome.away.delta).toBeCloseTo(0, 6)
        },
      ),
    )
  })

  it("is monotonic: raising the winner's rating (same bracket) never increases their gain", () => {
    fc.assert(
      fc.property(
        fc.record({
          rLower: fc.double({ min: 1200, max: 1800, noNaN: true }),
          bump: fc.double({ min: 0, max: 200, noNaN: true }),
          gp: bracket,
        }),
        ({ rLower, bump, gp }) => {
          const opponent = 1200
          const rHigher = rLower + bump

          const gainAt = (selfRating: number): number =>
            applyMatch(
              seededTable([
                [home, selfRating, gp],
                [away, opponent, gp],
              ]),
              { home, away, homeScore: 1, awayScore: 0 },
              testConfig,
            ).outcome.home.delta

          expect(gainAt(rHigher)).toBeLessThanOrEqual(gainAt(rLower) + 1e-9)
        },
      ),
    )
  })

  it('keeps expected scores in (0,1) summing to 1', () => {
    fc.assert(
      fc.property(fc.record({ rHome: rating, rAway: rating }), ({ rHome, rAway }) => {
        const eHome = expectedScore(rHome, rAway)
        const eAway = expectedScore(rAway, rHome)
        expect(eHome).toBeGreaterThan(0)
        expect(eHome).toBeLessThan(1)
        expect(eHome + eAway).toBeCloseTo(1, 9)
      }),
    )
  })

  it('leaves ratings unchanged on a draw between equal ratings', () => {
    fc.assert(
      fc.property(fc.record({ r: rating, gp: gamesPlayed }), ({ r, gp }) => {
        const { outcome } = applyMatch(
          seededTable([
            [home, r, gp],
            [away, r, gp],
          ]),
          { home, away, homeScore: 1, awayScore: 1 },
          testConfig,
        )
        expect(outcome.home.after.rating).toBeCloseTo(r, 9)
        expect(outcome.away.after.rating).toBeCloseTo(r, 9)
      }),
    )
  })

  it('never mutates the table it was given', () => {
    fc.assert(
      fc.property(matchScenario, ({ rHome, rAway, gpHome, gpAway, sHome, sAway }) => {
        const table = seededTable([
          [home, rHome, gpHome],
          [away, rAway, gpAway],
        ])
        const snapshot = new Map(table)

        applyMatch(table, { home, away, homeScore: sHome, awayScore: sAway }, testConfig)

        expect(table).toEqual(snapshot)
      }),
    )
  })

  it('replay is deterministic for a fixed sequence', () => {
    const players = [playerId('a'), playerId('b'), playerId('c')] as const
    const matchArb: fc.Arbitrary<MatchInput> = fc.record({
      home: fc.constantFrom(...players),
      away: fc.constantFrom(...players),
      homeScore: score,
      awayScore: score,
    })

    fc.assert(
      fc.property(
        fc
          .array(matchArb, { minLength: 1, maxLength: 20 })
          .filter((matches) => matches.every((m) => m.home !== m.away)),
        (matches) => {
          const first = replay(matches, testConfig)
          const second = replay(matches, testConfig)
          expect(second.table).toEqual(first.table)
        },
      ),
    )
  })

  it('is order-sensitive: permuting matches can change the final table (regression guard against a set-based fold)', () => {
    const a = playerId('a')
    const b = playerId('b')
    const c = playerId('c')

    const original: MatchInput[] = [
      { home: a, away: b, homeScore: 3, awayScore: 0 },
      { home: b, away: c, homeScore: 3, awayScore: 0 },
      { home: c, away: a, homeScore: 3, awayScore: 0 },
    ]
    const reversed = [...original].reverse()

    const resultOriginal = replay(original, testConfig)
    const resultReversed = replay(reversed, testConfig)

    expect(resultReversed.table).not.toEqual(resultOriginal.table)
  })
})
