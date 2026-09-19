import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { toMatchInputs, type ReplayableMatch } from '../../../../src/domain/match/result.js'
import { applyMatch, replay } from '../../../../src/domain/rating/engine.js'
import type {
  EliteK,
  EloParams,
  MatchOutcome,
  PlayerId,
  RatingConfig,
  RatingState,
  RatingTable,
} from '../../../../src/domain/rating/types.js'
import { configWith, playerId, stateTable, testConfig, testEloParams } from '../factories.js'

/**
 * Properties of the optional Elo features. properties.test.ts keeps pinning the default config
 * (zero-sum within a bracket included); this file checks the properties that must hold for EVERY
 * flag combination, pins down exactly which flags break zero-sum and which don't, and checks that
 * "disabled" means bit-for-bit "absent".
 */

const home = playerId('home')
const away = playerId('away')

// --- arbitraries ------------------------------------------------------------------------------

const eliteKArb: fc.Arbitrary<EliteK> = fc
  .record({
    enabled: fc.boolean(),
    enterAt: fc.double({ min: 1000, max: 2000, noNaN: true }),
    band: fc.double({ min: 0, max: 200, noNaN: true }),
    k: fc.double({ min: 1, max: 60, noNaN: true }),
    requireEstablished: fc.boolean(),
  })
  .map(({ band, ...eliteK }) => ({ ...eliteK, exitAt: eliteK.enterAt - band }))

/** Any valid combination of the optional features, each independently absent, off, or on. */
const featuresArb: fc.Arbitrary<Partial<EloParams>> = fc.record(
  {
    expectationScale: fc.double({ min: 100, max: 1600, noNaN: true }),
    goalDifferenceFactor: fc.record({
      enabled: fc.boolean(),
      divisor: fc.double({ min: 0.5, max: 5, noNaN: true }),
      cap: fc.double({ min: 1, max: 3, noNaN: true }),
    }),
    eliteK: eliteKArb,
    repeatOpponentDamping: fc.record({
      enabled: fc.boolean(),
      threshold: fc.integer({ min: 0, max: 6 }),
      factor: fc.double({ min: 0.05, max: 1, noNaN: true }),
      minMultiplier: fc.double({ min: 0.05, max: 1, noNaN: true }),
    }),
    maxDelta: fc.double({ min: 0.5, max: 60, noNaN: true }),
    ratingFloor: fc.double({ min: 0, max: testEloParams.baseline, noNaN: true }),
  },
  { requiredKeys: [] },
)

const configArb: fc.Arbitrary<RatingConfig> = featuresArb.map(configWith)

const rating = fc.double({ min: 0, max: 3000, noNaN: true })
const gamesPlayed = fc.integer({ min: 0, max: 60 })
const bracket = fc.constantFrom(0, 20) // 0 = provisional, 20 = established
const score = fc.integer({ min: 0, max: 10 })
const priorMeetings = fc.integer({ min: 0, max: 20 })

/** The config schema requires ratingFloor <= baseline, so a rating below the floor is unreachable. */
const reachable = (config: RatingConfig, ...ratings: number[]) =>
  ratings.every((r) => config.params.ratingFloor === undefined || r >= config.params.ratingFloor)

function play(
  config: RatingConfig,
  homeState: RatingState,
  awayState: RatingState,
  homeScore: number,
  awayScore: number,
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

const players = [playerId('a'), playerId('b'), playerId('c')] as const
const sessionMatchArb: fc.Arbitrary<ReplayableMatch> = fc
  .record({
    homePlayerId: fc.constantFrom(...players),
    awayPlayerId: fc.constantFrom(...players),
    homeScore: score,
    awayScore: score,
    sessionId: fc.constantFrom<string | null>('s1', 's2', null),
  })
  .filter((match) => match.homePlayerId !== match.awayPlayerId)
const matchLogArb = fc.array(sessionMatchArb, { minLength: 1, maxLength: 25 })

// --- disabled === absent ------------------------------------------------------------------------

describe('with every feature present but disabled', () => {
  const disabled = configWith({
    expectationScale: 400,
    goalDifferenceFactor: { enabled: false, divisor: 2, cap: 1.5 },
    eliteK: { enabled: false, enterAt: 1500, exitAt: 1450, k: 16, requireEstablished: true },
    repeatOpponentDamping: { enabled: false, threshold: 3, factor: 0.85, minMultiplier: 0.25 },
  })

  it('produces bit-identical outcomes to the plain default config', () => {
    fc.assert(
      fc.property(
        fc.record({
          rHome: rating,
          rAway: rating,
          gpHome: gamesPlayed,
          gpAway: gamesPlayed,
          sHome: score,
          sAway: score,
          prior: priorMeetings,
        }),
        ({ rHome, rAway, gpHome, gpAway, sHome, sAway, prior }) => {
          const homeState = { rating: rHome, gamesPlayed: gpHome }
          const awayState = { rating: rAway, gamesPlayed: gpAway }
          // toStrictEqual compares numbers with Object.is — exact bits, not a tolerance — and
          // rejects any extra key (an isElite leaking into a default-config state).
          expect(play(disabled, homeState, awayState, sHome, sAway, prior)).toStrictEqual(
            play(testConfig, homeState, awayState, sHome, sAway, prior),
          )
        },
      ),
    )
  })

  it('replays a whole log bit-identically', () => {
    fc.assert(
      fc.property(matchLogArb, (log) => {
        expect(replay(toMatchInputs(log), disabled)).toStrictEqual(
          replay(toMatchInputs(log), testConfig),
        )
      }),
    )
  })
})

// --- properties that hold for every flag combination --------------------------------------------

describe('for every combination of features', () => {
  it('leaves ratings unchanged on a draw between equal ratings (elite flags may differ)', () => {
    fc.assert(
      fc.property(
        fc.record({
          config: configArb,
          r: rating,
          gp: gamesPlayed,
          homeElite: fc.boolean(),
          awayElite: fc.boolean(),
          goals: score,
          prior: priorMeetings,
        }),
        ({ config, r, gp, homeElite, awayElite, goals, prior }) => {
          fc.pre(reachable(config, r))
          const outcome = play(
            config,
            { rating: r, gamesPlayed: gp, isElite: homeElite },
            { rating: r, gamesPlayed: gp, isElite: awayElite },
            goals,
            goals,
            prior,
          )
          expect(outcome.home.after.rating).toBe(r)
          expect(outcome.away.after.rating).toBe(r)
        },
      ),
    )
  })

  it("is monotonic: raising the winner's rating (same bracket, same elite flag) never increases their gain", () => {
    fc.assert(
      fc.property(
        fc.record({
          config: configArb,
          rLower: fc.double({ min: 1200, max: 1800, noNaN: true }),
          bump: fc.double({ min: 0, max: 200, noNaN: true }),
          gp: bracket,
          isElite: fc.boolean(),
          margin: fc.integer({ min: 1, max: 5 }),
          prior: priorMeetings,
        }),
        ({ config, rLower, bump, gp, isElite, margin, prior }) => {
          const opponent = { rating: 1200, gamesPlayed: gp, isElite: false }
          const gainAt = (selfRating: number): number =>
            play(
              config,
              { rating: selfRating, gamesPlayed: gp, isElite },
              opponent,
              margin,
              0,
              prior,
            ).home.delta

          expect(gainAt(rLower + bump)).toBeLessThanOrEqual(gainAt(rLower) + 1e-9)
        },
      ),
    )
  })

  it('never mutates the table it was given', () => {
    fc.assert(
      fc.property(
        fc.record({
          config: configArb,
          rHome: rating,
          rAway: rating,
          gpHome: gamesPlayed,
          gpAway: gamesPlayed,
          homeElite: fc.boolean(),
          sHome: score,
          sAway: score,
          prior: priorMeetings,
        }),
        ({ config, rHome, rAway, gpHome, gpAway, homeElite, sHome, sAway, prior }) => {
          const table = stateTable([
            [home, { rating: rHome, gamesPlayed: gpHome, isElite: homeElite }],
            [away, { rating: rAway, gamesPlayed: gpAway }],
          ])
          const snapshot = structuredClone(new Map(table))

          applyMatch(
            table,
            { home, away, homeScore: sHome, awayScore: sAway, priorSessionMeetings: prior },
            config,
          )

          expect(table).toStrictEqual(snapshot)
        },
      ),
    )
  })

  it('replay is deterministic for a fixed sequence', () => {
    fc.assert(
      fc.property(configArb, matchLogArb, (config, log) => {
        expect(replay(toMatchInputs(log), config)).toStrictEqual(replay(toMatchInputs(log), config))
      }),
    )
  })
})

// --- order sensitivity, over the full toggle matrix ----------------------------------------------

/**
 * One representative "on" setting per toggle (maxDelta and ratingFloor are separate toggles),
 * tuned to engage on the fixture below: elite enters at 1215, damping bites from the 2nd meeting,
 * maxDelta 18 clips a 20-point swing, the floor catches a 20-point loss from 1200.
 */
const TOGGLES: Readonly<Record<string, Partial<EloParams>>> = {
  expectationScale: { expectationScale: 600 },
  goalDifferenceFactor: { goalDifferenceFactor: { enabled: true, divisor: 2, cap: 1.5 } },
  eliteK: {
    eliteK: { enabled: true, enterAt: 1215, exitAt: 1195, k: 16, requireEstablished: false },
  },
  repeatOpponentDamping: {
    repeatOpponentDamping: { enabled: true, threshold: 1, factor: 0.5, minMultiplier: 0.25 },
  },
  maxDelta: { maxDelta: 18 },
  ratingFloor: { ratingFloor: 1185 },
}
const toggleNames = Object.keys(TOGGLES)

const combos = Array.from({ length: 2 ** toggleNames.length }, (_, mask) =>
  toggleNames.filter((_, bit) => (mask & (1 << bit)) !== 0),
)
const configFor = (names: readonly string[]) =>
  configWith(Object.assign({}, ...names.map((name) => TOGGLES[name])) as Partial<EloParams>)

const [a, b, c] = players
const m = (home: PlayerId, away: PlayerId, homeScore: number, awayScore: number) => ({
  homePlayerId: home,
  awayPlayerId: away,
  homeScore,
  awayScore,
  sessionId: 's1',
})
/**
 * Uneven margins, a repeated pair, and a draw. The default properties' 3-cycle (each player one
 * 3-0 win, one 3-0 loss) is too symmetric here: under a maxDelta that clips every match to the
 * same ±cap, both orders collapse back to all-equal ratings.
 */
const FIXTURE = [
  m(a, b, 3, 0),
  m(a, b, 1, 0),
  m(b, c, 2, 1),
  m(c, a, 4, 0),
  m(a, b, 2, 2),
  m(c, b, 1, 0),
]

const finalTable = (config: RatingConfig, log: readonly ReplayableMatch[]): RatingTable =>
  replay(toMatchInputs(log), config).table

describe('order sensitivity (regression guard against a set-based fold)', () => {
  it.each(combos.map((names) => [names.join(' + ') || 'none', names] as const))(
    'permuting matches changes the final table — with %s',
    (_label, names) => {
      const config = configFor(names)
      expect(finalTable(config, [...FIXTURE].reverse())).not.toEqual(finalTable(config, FIXTURE))
    },
  )

  // Without this, the matrix above could pass with toggles that never actually engaged.
  it.each(toggleNames)('the %s toggle actually changes the fixture’s outcome', (name) => {
    expect(finalTable(configFor([name]), FIXTURE)).not.toEqual(finalTable(testConfig, FIXTURE))
  })
})

// --- zero-sum: which flags preserve it, which break it --------------------------------------------

describe('zero-sum within a shared K bracket', () => {
  // Everything except the two features that break zero-sum on purpose (tested explicitly below).
  const symmetricFeaturesArb = featuresArb.map((features) => {
    const symmetric = { ...features }
    delete symmetric.eliteK
    delete symmetric.ratingFloor
    return configWith(symmetric)
  })

  it('is preserved by expectationScale, goalDifferenceFactor, repeatOpponentDamping and maxDelta', () => {
    fc.assert(
      fc.property(
        fc.record({
          config: symmetricFeaturesArb,
          rHome: rating,
          rAway: rating,
          gp: bracket,
          sHome: score,
          sAway: score,
          prior: priorMeetings,
        }),
        ({ config, rHome, rAway, gp, sHome, sAway, prior }) => {
          const outcome = play(
            config,
            { rating: rHome, gamesPlayed: gp },
            { rating: rAway, gamesPlayed: gp },
            sHome,
            sAway,
            prior,
          )
          expect(outcome.home.delta + outcome.away.delta).toBeCloseTo(0, 6)
        },
      ),
    )
  })

  it('maxDelta clips both sides of a same-bracket match equally (±20 → ±10), so it stays zero-sum', () => {
    const outcome = play(
      configWith({ maxDelta: 10 }),
      { rating: 1200, gamesPlayed: 0 },
      { rating: 1200, gamesPlayed: 0 },
      1,
      0,
    )
    expect(outcome.home.delta + outcome.away.delta).toBeCloseTo(0, 9)
  })

  it('maxDelta can only change the sum of a match that was already asymmetric (provisional vs established)', () => {
    const provisional = { rating: 1200, gamesPlayed: 0 }
    const established = { rating: 1200, gamesPlayed: 10 }
    const plain = play(testConfig, provisional, established, 1, 0) // +20 / −12
    const clipped = play(configWith({ maxDelta: 15 }), provisional, established, 1, 0) // +15 / −12

    expect(plain.home.delta + plain.away.delta).toBeCloseTo(8, 9)
    expect(clipped.home.delta + clipped.away.delta).toBeCloseTo(3, 9)
  })

  it('is deliberately broken by eliteK when only one side is elite: +8 (k=16) vs −12 (K=24)', () => {
    const outcome = play(
      configWith({
        eliteK: { enabled: true, enterAt: 1500, exitAt: 1450, k: 16, requireEstablished: true },
      }),
      { rating: 1480, gamesPlayed: 10, isElite: true },
      { rating: 1480, gamesPlayed: 10, isElite: false },
      1,
      0,
    )
    expect(outcome.home.delta).toBeCloseTo(8, 9)
    expect(outcome.away.delta).toBeCloseTo(-12, 9)
    expect(outcome.home.delta + outcome.away.delta).toBeCloseTo(-4, 9)
  })

  it('is deliberately broken by ratingFloor when it catches the loser: +12 vs 0', () => {
    const outcome = play(
      configWith({ ratingFloor: 1000 }),
      { rating: 1000, gamesPlayed: 10 },
      { rating: 1000, gamesPlayed: 10 },
      1,
      0,
    )
    expect(outcome.home.delta).toBeCloseTo(12, 9)
    expect(outcome.away.delta).toBe(0)
    expect(outcome.home.delta + outcome.away.delta).toBeCloseTo(12, 9)
  })
})

// --- incremental === replay, at the domain level ------------------------------------------------

/**
 * What the incremental path actually hands the engine: rating_snapshots' latest row per player,
 * read back by latestSnapshotsFor as { rating, gamesPlayed, isElite } — isElite always present
 * (false when the config has no eliteK). The DB round trip is the whole point: a state the engine
 * produced must survive it without losing anything the next match reads.
 */
const persisted = (state: RatingState): RatingState => ({
  rating: state.rating,
  gamesPlayed: state.gamesPlayed,
  isElite: state.isElite ?? false,
})

function incremental(
  log: readonly ReplayableMatch[],
  config: RatingConfig,
  roundTrip: (state: RatingState, config: RatingConfig) => RatingState,
): MatchOutcome[] {
  let table: RatingTable = new Map()
  return toMatchInputs(log).map((input) => {
    const result = applyMatch(table, input, config)
    table = new Map([...result.table].map(([id, state]) => [id, roundTrip(state, config)]))
    return result.outcome
  })
}

describe('folding one match at a time through a persisted state equals a full replay', () => {
  it('for every combination of features', () => {
    fc.assert(
      fc.property(configArb, matchLogArb, (config, log) => {
        expect(incremental(log, config, persisted)).toStrictEqual(
          replay(toMatchInputs(log), config).outcomes,
        )
      }),
    )
  })

  it('but NOT if the elite flag were derived from rating instead of persisted (negative control)', () => {
    const eliteK: EliteK = {
      enabled: true,
      enterAt: 1215,
      exitAt: 1195,
      k: 16,
      requireEstablished: false,
    }
    const config = configWith({ eliteK })
    // The tempting shortcut: "elite = rating >= enterAt". Wrong inside the hysteresis band.
    const derived = (state: RatingState): RatingState => ({
      rating: state.rating,
      gamesPlayed: state.gamesPlayed,
      isElite: state.rating >= eliteK.enterAt,
    })
    // a beats b (a → 1220, elite); c beats a (a elite, K=16 → ~1211.5, inside the band, still
    // elite); a plays b again — replay knows a is elite, the derived shortcut says a isn't.
    const log = [m(a, b, 1, 0), m(c, a, 1, 0), m(a, b, 1, 0)]
    const replayed = replay(toMatchInputs(log), config).outcomes

    const inBand = replayed[2]?.home.before
    expect(inBand?.isElite).toBe(true)
    expect(inBand?.rating).toBeGreaterThanOrEqual(eliteK.exitAt)
    expect(inBand?.rating).toBeLessThan(eliteK.enterAt)

    expect(incremental(log, config, persisted)).toStrictEqual(replayed)
    expect(incremental(log, config, derived)).not.toStrictEqual(replayed)
  })
})
