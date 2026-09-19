import { actualScore, expectedScore, nextRating, ratingState } from './elo.js'
import type {
  MatchInput,
  MatchOutcome,
  ParticipantOutcome,
  PlayerId,
  RatingConfig,
  RatingState,
  RatingTable,
  ReplayResult,
} from './types.js'

/** Rating state for a player not yet in the table. */
export function initialState(config: RatingConfig): RatingState {
  return ratingState(config.params.baseline, 0, false, config.params)
}

/**
 * A stored state as this config sees it. The elite flag only exists under a config with eliteK
 * enabled: the DB layer always reads is_elite_after back, so it's dropped here for every other
 * config (keeping their states exactly { rating, gamesPlayed }), and defaulted to false for an
 * elite config handed a state that never had one.
 */
function lookup(table: RatingTable, playerId: PlayerId, config: RatingConfig): RatingState {
  const state = table.get(playerId)
  if (state === undefined) return initialState(config)

  const eliteEnabled = config.params.eliteK?.enabled === true
  if (eliteEnabled === (state.isElite !== undefined)) return state
  return eliteEnabled
    ? { rating: state.rating, gamesPlayed: state.gamesPlayed, isElite: false }
    : { rating: state.rating, gamesPlayed: state.gamesPlayed }
}

function computeOutcome(
  table: RatingTable,
  match: MatchInput,
  config: RatingConfig,
): { outcome: MatchOutcome; table: RatingTable } {
  const { params } = config
  const homeBefore = lookup(table, match.home, config)
  const awayBefore = lookup(table, match.away, config)

  const homeExpected = expectedScore(homeBefore.rating, awayBefore.rating, params.expectationScale)
  const awayExpected = 1 - homeExpected
  const homeActual = actualScore(match.homeScore, match.awayScore)
  const awayActual = actualScore(match.awayScore, match.homeScore)

  const homeAfter = nextRating(homeBefore, homeExpected, homeActual, match, params)
  const awayAfter = nextRating(awayBefore, awayExpected, awayActual, match, params)

  const home: ParticipantOutcome = {
    playerId: match.home,
    before: homeBefore,
    after: homeAfter,
    expectedScore: homeExpected,
    actualScore: homeActual,
    delta: homeAfter.rating - homeBefore.rating,
    wasProvisional: homeBefore.gamesPlayed < params.provisionalGames,
  }
  const away: ParticipantOutcome = {
    playerId: match.away,
    before: awayBefore,
    after: awayAfter,
    expectedScore: awayExpected,
    actualScore: awayActual,
    delta: awayAfter.rating - awayBefore.rating,
    wasProvisional: awayBefore.gamesPlayed < params.provisionalGames,
  }

  const winner = homeActual === 1 ? home : awayActual === 1 ? away : null
  const upset = winner !== null && winner.expectedScore < 0.5

  const newTable = new Map(table)
  newTable.set(match.home, homeAfter)
  newTable.set(match.away, awayAfter)

  return { outcome: { home, away, upset }, table: newTable }
}

/** Apply a single match; returns a new table (immutable) and the outcome. */
export function applyMatch(
  table: RatingTable,
  match: MatchInput,
  config: RatingConfig,
): { table: RatingTable; outcome: MatchOutcome } {
  return computeOutcome(table, match, config)
}

/** Compute expected scores and hypothetical deltas without committing (powers the preview line). */
export function previewMatch(
  table: RatingTable,
  match: MatchInput,
  config: RatingConfig,
): MatchOutcome {
  return computeOutcome(table, match, config).outcome
}

/** Fold an ordered list of effective matches from an empty table. */
export function replay(matches: readonly MatchInput[], config: RatingConfig): ReplayResult {
  let table: RatingTable = new Map()
  const outcomes: MatchOutcome[] = []
  for (const match of matches) {
    const result = applyMatch(table, match, config)
    table = result.table
    outcomes.push(result.outcome)
  }
  return { table, outcomes }
}
