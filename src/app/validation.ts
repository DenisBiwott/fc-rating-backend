import { MatchValidationError } from './errors.js'

export interface MatchShapeInput {
  homePlayerId: string
  awayPlayerId: string
  homeScore: number
  awayScore: number
}

/** Shared by recordMatch, previewMatch, and correctMatch — the same shape rules apply everywhere a score gets fed to the rating engine. */
export function validateMatchShape(input: MatchShapeInput): void {
  if (input.homePlayerId === input.awayPlayerId) {
    throw new MatchValidationError('A match cannot be played against yourself.')
  }
  for (const score of [input.homeScore, input.awayScore]) {
    if (!Number.isInteger(score) || score < 0 || score > 99) {
      throw new MatchValidationError('Scores must be integers between 0 and 99.')
    }
  }
}
