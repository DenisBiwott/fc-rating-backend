import { describe, expect, it } from 'vitest'
import {
  goalsAgainst,
  goalsFor,
  resultFor,
  toMatchInputs,
} from '../../../../src/domain/match/result.js'
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
  sessionId: null,
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

describe('toMatchInputs', () => {
  const carol = playerId('carol')
  const inSession = (sessionId: string | null, home = alice, away = bob): EffectiveMatch => ({
    ...match,
    homePlayerId: home,
    awayPlayerId: away,
    sessionId,
  })
  const priors = (matches: readonly EffectiveMatch[]) =>
    toMatchInputs(matches).map((input) => input.priorSessionMeetings)

  it('drops id, sequence, isVoid, and sessionId', () => {
    expect(toMatchInputs([match])).toEqual([
      { home: alice, away: bob, homeScore: 2, awayScore: 1, priorSessionMeetings: 0 },
    ])
  })

  it('counts earlier meetings of the same pair within a session, either way round', () => {
    expect(
      priors([
        inSession('s1'),
        inSession('s1', bob, alice),
        inSession('s1'),
        inSession('s1', bob, alice),
      ]),
    ).toEqual([0, 1, 2, 3])
  })

  it('counts each pair separately', () => {
    expect(priors([inSession('s1'), inSession('s1', alice, carol), inSession('s1')])).toEqual([
      0, 0, 1,
    ])
  })

  it('starts every session from zero', () => {
    expect(priors([inSession('s1'), inSession('s2'), inSession('s1'), inSession('s2')])).toEqual([
      0, 0, 1, 1,
    ])
  })

  it('never counts a match with no session as a repeat, nor lets it count toward one', () => {
    expect(priors([inSession(null), inSession(null), inSession('s1'), inSession(null)])).toEqual([
      0, 0, 0, 0,
    ])
  })
})
