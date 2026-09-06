import type {
  EloParams,
  PlayerId,
  RatingConfig,
  RatingState,
  RatingTable,
} from '../../../src/domain/rating/types.js'

export function playerId(id: string): PlayerId {
  return id as PlayerId
}

export const testEloParams: EloParams = {
  baseline: 1200,
  kProvisional: 40,
  provisionalGames: 10,
  kEstablished: 24,
  drawScore: 0.5,
}

export const testConfig: RatingConfig = { algorithm: 'elo', params: testEloParams }

/** Builds a RatingTable directly from (id, rating, gamesPlayed) triples, bypassing initialState. */
export function seededTable(
  entries: readonly (readonly [PlayerId, number, number])[],
): RatingTable {
  const table = new Map<PlayerId, RatingState>()
  for (const [id, rating, gamesPlayed] of entries) {
    table.set(id, { rating, gamesPlayed })
  }
  return table
}
