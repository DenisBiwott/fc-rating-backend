import { actualScore, expectedScore, nextRating } from './elo.js'
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
  return { rating: config.params.baseline, gamesPlayed: 0 }
}

function lookup(table: RatingTable, playerId: PlayerId, config: RatingConfig): RatingState {
  return table.get(playerId) ?? initialState(config)
}

function computeOutcome(
  table: RatingTable,
  match: MatchInput,
  config: RatingConfig,
): { outcome: MatchOutcome; table: RatingTable } {
  const homeBefore = lookup(table, match.home, config)
  const awayBefore = lookup(table, match.away, config)

  const homeExpected = expectedScore(homeBefore.rating, awayBefore.rating)
  const awayExpected = 1 - homeExpected
  const homeActual = actualScore(match.homeScore, match.awayScore)
  const awayActual = actualScore(match.awayScore, match.homeScore)

  const homeAfter = nextRating(homeBefore, homeExpected, homeActual, config.params)
  const awayAfter = nextRating(awayBefore, awayExpected, awayActual, config.params)

  const home: ParticipantOutcome = {
    playerId: match.home,
    before: homeBefore,
    after: homeAfter,
    expectedScore: homeExpected,
    actualScore: homeActual,
    delta: homeAfter.rating - homeBefore.rating,
    wasProvisional: homeBefore.gamesPlayed < config.params.provisionalGames,
  }
  const away: ParticipantOutcome = {
    playerId: match.away,
    before: awayBefore,
    after: awayAfter,
    expectedScore: awayExpected,
    actualScore: awayActual,
    delta: awayAfter.rating - awayBefore.rating,
    wasProvisional: awayBefore.gamesPlayed < config.params.provisionalGames,
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
