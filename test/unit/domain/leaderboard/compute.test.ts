import { describe, expect, it } from 'vitest'
import {
  bestStreak,
  currentStreak,
  isProvisional,
  rankPlayers,
  recentForm,
} from '../../../../src/domain/leaderboard/compute.js'
import type { PlayerMatchRecord } from '../../../../src/domain/leaderboard/types.js'
import { playerId } from '../factories.js'

const alice = playerId('alice')
const bob = playerId('bob')
const carol = playerId('carol')

describe('rankPlayers', () => {
  it('orders by rating descending', () => {
    const ranked = rankPlayers([
      { playerId: alice, rating: 1200, gamesPlayed: 5 },
      { playerId: bob, rating: 1400, gamesPlayed: 5 },
      { playerId: carol, rating: 1300, gamesPlayed: 5 },
    ])
    expect(ranked.map((p) => p.playerId)).toEqual([bob, carol, alice])
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3])
  })

  it('breaks ties deterministically by playerId', () => {
    const rankedOnce = rankPlayers([
      { playerId: bob, rating: 1200, gamesPlayed: 5 },
      { playerId: alice, rating: 1200, gamesPlayed: 5 },
    ])
    const rankedAgain = rankPlayers([
      { playerId: alice, rating: 1200, gamesPlayed: 5 },
      { playerId: bob, rating: 1200, gamesPlayed: 5 },
    ])
    expect(rankedOnce.map((p) => p.playerId)).toEqual(rankedAgain.map((p) => p.playerId))
  })
})

describe('isProvisional', () => {
  it('is true while gamesPlayed is below the threshold', () => {
    expect(isProvisional(9, 10)).toBe(true)
    expect(isProvisional(10, 10)).toBe(false)
  })
})

describe('recentForm', () => {
  const records: PlayerMatchRecord[] = [
    { sequence: 3, result: 'D' },
    { sequence: 1, result: 'W' },
    { sequence: 2, result: 'L' },
    { sequence: 4, result: 'W' },
  ]

  it('returns results oldest-to-newest, capped at count', () => {
    expect(recentForm(records, 3)).toEqual(['L', 'D', 'W'])
  })

  it('returns everything when there are fewer than count records', () => {
    expect(recentForm(records, 10)).toEqual(['W', 'L', 'D', 'W'])
  })
})

describe('currentStreak', () => {
  it('returns null when no matches have been played', () => {
    expect(currentStreak([])).toBeNull()
  })

  it('counts consecutive same results ending at the most recent match', () => {
    const records: PlayerMatchRecord[] = [
      { sequence: 1, result: 'L' },
      { sequence: 2, result: 'W' },
      { sequence: 3, result: 'W' },
      { sequence: 4, result: 'W' },
    ]
    expect(currentStreak(records)).toEqual({ result: 'W', length: 3 })
  })

  it('resets at the most recent differing result', () => {
    const records: PlayerMatchRecord[] = [
      { sequence: 1, result: 'W' },
      { sequence: 2, result: 'W' },
      { sequence: 3, result: 'L' },
    ]
    expect(currentStreak(records)).toEqual({ result: 'L', length: 1 })
  })
})

describe('bestStreak', () => {
  it('returns null when no matches have been played', () => {
    expect(bestStreak([])).toBeNull()
  })

  it('returns the single streak when there is only one', () => {
    const records: PlayerMatchRecord[] = [
      { sequence: 1, result: 'W' },
      { sequence: 2, result: 'W' },
    ]
    expect(bestStreak(records)).toEqual({ result: 'W', length: 2 })
  })

  it('finds the longest streak even when it is not the most recent one', () => {
    const records: PlayerMatchRecord[] = [
      { sequence: 1, result: 'W' },
      { sequence: 2, result: 'W' },
      { sequence: 3, result: 'W' },
      { sequence: 4, result: 'L' },
      { sequence: 5, result: 'W' },
      { sequence: 6, result: 'L' },
    ]
    // current streak here is L (length 1) — best is the earlier 3-game W run.
    expect(currentStreak(records)).toEqual({ result: 'L', length: 1 })
    expect(bestStreak(records)).toEqual({ result: 'W', length: 3 })
  })
})
