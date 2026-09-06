import { describe, expect, it } from 'vitest'
import {
  applyMatch,
  initialState,
  previewMatch,
  replay,
} from '../../../../src/domain/rating/engine.js'
import { playerId, testConfig } from '../factories.js'

describe('initialState', () => {
  it('returns the configured baseline with zero games played', () => {
    expect(initialState(testConfig)).toEqual({ rating: 1200, gamesPlayed: 0 })
  })
})

describe('applyMatch', () => {
  it('defaults unknown players to initialState', () => {
    const home = playerId('home')
    const away = playerId('away')
    const { outcome } = applyMatch(
      new Map(),
      { home, away, homeScore: 1, awayScore: 1 },
      testConfig,
    )

    expect(outcome.home.before).toEqual({ rating: 1200, gamesPlayed: 0 })
    expect(outcome.away.before).toEqual({ rating: 1200, gamesPlayed: 0 })
  })

  it('never mutates the table it was given', () => {
    const home = playerId('home')
    const away = playerId('away')
    const table = new Map([
      [home, { rating: 1200, gamesPlayed: 10 }],
      [away, { rating: 1200, gamesPlayed: 10 }],
    ])
    const snapshot = new Map(table)

    applyMatch(table, { home, away, homeScore: 1, awayScore: 0 }, testConfig)

    expect(table).toEqual(snapshot)
  })
})

describe('previewMatch', () => {
  it('computes the same outcome as applyMatch without persisting it', () => {
    const home = playerId('home')
    const away = playerId('away')
    const table = new Map([
      [home, { rating: 1300, gamesPlayed: 5 }],
      [away, { rating: 1250, gamesPlayed: 12 }],
    ])

    const previewed = previewMatch(table, { home, away, homeScore: 2, awayScore: 2 }, testConfig)
    const { outcome: applied, table: nextTable } = applyMatch(
      table,
      { home, away, homeScore: 2, awayScore: 2 },
      testConfig,
    )

    expect(previewed).toEqual(applied)
    expect(nextTable.get(home)).not.toEqual(table.get(home)) // applyMatch did commit
  })
})

describe('replay', () => {
  it('folds matches in order and returns one outcome per match', () => {
    const a = playerId('a')
    const b = playerId('b')
    const c = playerId('c')

    const result = replay(
      [
        { home: a, away: b, homeScore: 1, awayScore: 0 },
        { home: b, away: c, homeScore: 0, awayScore: 2 },
        { home: c, away: a, homeScore: 1, awayScore: 1 },
      ],
      testConfig,
    )

    expect(result.outcomes).toHaveLength(3)
    expect(result.table.get(a)?.gamesPlayed).toBe(2)
    expect(result.table.get(b)?.gamesPlayed).toBe(2)
    expect(result.table.get(c)?.gamesPlayed).toBe(2)
  })
})
