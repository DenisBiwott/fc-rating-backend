import { describe, expect, it } from 'vitest'
import { effectiveMatches } from '../../../../src/domain/match/effective.js'
import type { StoredAdjustment, StoredMatch } from '../../../../src/domain/match/types.js'
import { playerId } from '../factories.js'

const alice = playerId('alice')
const bob = playerId('bob')
const carol = playerId('carol')

const baseMatch: StoredMatch = {
  id: 'm1',
  sequence: 1,
  homePlayerId: alice,
  awayPlayerId: bob,
  homeScore: 2,
  awayScore: 1,
  sessionId: 's1',
}

describe('effectiveMatches', () => {
  it('passes through matches with no adjustments unchanged', () => {
    const [effective] = effectiveMatches([baseMatch], [])
    expect(effective).toEqual({ ...baseMatch, isVoid: false })
  })

  it('marks the match void but keeps it in the list when the latest adjustment is a void', () => {
    const voidAdjustment: StoredAdjustment = { matchId: 'm1', sequence: 1, type: 'void' }
    const [effective] = effectiveMatches([baseMatch], [voidAdjustment])
    expect(effective).toEqual({ ...baseMatch, isVoid: true })
  })

  it('overlays a correct adjustment onto the original scores/players', () => {
    const correction: StoredAdjustment = {
      matchId: 'm1',
      sequence: 1,
      type: 'correct',
      newHomePlayerId: alice,
      newAwayPlayerId: carol,
      newHomeScore: 3,
      newAwayScore: 3,
    }
    const [effective] = effectiveMatches([baseMatch], [correction])
    expect(effective).toEqual({
      id: 'm1',
      sequence: 1,
      homePlayerId: alice,
      awayPlayerId: carol,
      homeScore: 3,
      awayScore: 3,
      sessionId: 's1', // a correction never moves a match between sessions
      isVoid: false,
    })
  })

  it('uses only the latest adjustment when several exist for the same match', () => {
    const firstCorrection: StoredAdjustment = {
      matchId: 'm1',
      sequence: 1,
      type: 'correct',
      newHomePlayerId: alice,
      newAwayPlayerId: bob,
      newHomeScore: 5,
      newAwayScore: 0,
    }
    const laterVoid: StoredAdjustment = { matchId: 'm1', sequence: 2, type: 'void' }

    const [effective] = effectiveMatches([baseMatch], [firstCorrection, laterVoid])
    expect(effective?.isVoid).toBe(true)
  })

  it('picks the highest-sequence adjustment even when the input array is not sorted', () => {
    const earlyCorrection: StoredAdjustment = {
      matchId: 'm1',
      sequence: 1,
      type: 'correct',
      newHomePlayerId: alice,
      newAwayPlayerId: bob,
      newHomeScore: 5,
      newAwayScore: 0,
    }
    const laterVoid: StoredAdjustment = { matchId: 'm1', sequence: 2, type: 'void' }

    // Deliberately fed newest-first, to prove latestAdjustment doesn't just take the last
    // array element — it tracks the highest sequence seen regardless of input order.
    const [effective] = effectiveMatches([baseMatch], [laterVoid, earlyCorrection])
    expect(effective?.isVoid).toBe(true)
  })

  it('sorts by match sequence regardless of input order', () => {
    const second: StoredMatch = { ...baseMatch, id: 'm2', sequence: 2 }
    const result = effectiveMatches([second, baseMatch], [])
    expect(result.map((m) => m.id)).toEqual(['m1', 'm2'])
  })
})
