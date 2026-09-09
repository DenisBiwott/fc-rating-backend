import { describe, expect, it } from 'vitest'
import { goalsAgainst, goalsFor, resultFor, toMatchInput } from '../../../../src/domain/match/result.js'
import type { EffectiveMatch } from '../../../../src/domain/match/types.js'
import { playerId } from '../factories.js'

const alice = playerId('alice')
const bob = playerId('bob')

const match: EffectiveMatch = {
  id: 'm1',
  sequence: 1,
  homePlayerId: alice,
  awayPlayerId: bob,
  homeScore: 2,
  awayScore: 1,
  isVoid: false,
}

describe('resultFor', () => {
  it('returns W for the home winner', () => {
    expect(resultFor(match, alice)).toBe('W')
  })

  it('returns L for the away loser', () => {
    expect(resultFor(match, bob)).toBe('L')
  })

  it('returns D for both sides on a draw', () => {
    const draw: EffectiveMatch = { ...match, homeScore: 1, awayScore: 1 }
    expect(resultFor(draw, alice)).toBe('D')
    expect(resultFor(draw, bob)).toBe('D')
  })
})

describe('goalsFor', () => {
  it('returns the home score for the home player', () => {
    expect(goalsFor(match, alice)).toBe(2)
  })

  it('returns the away score for the away player', () => {
    expect(goalsFor(match, bob)).toBe(1)
  })
})

describe('goalsAgainst', () => {
  it('returns the away score for the home player', () => {
    expect(goalsAgainst(match, alice)).toBe(1)
  })

  it('returns the home score for the away player', () => {
    expect(goalsAgainst(match, bob)).toBe(2)
  })
})

describe('toMatchInput', () => {
  it('drops id, sequence, and isVoid', () => {
    expect(toMatchInput(match)).toEqual({
      home: alice,
      away: bob,
      homeScore: 2,
      awayScore: 1,
    })
  })
})
