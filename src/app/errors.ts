export class MatchValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatchValidationError'
  }
}

export class MatchNotFoundError extends Error {
  constructor(matchId: string) {
    super(`Match not found: ${matchId}`)
    this.name = 'MatchNotFoundError'
  }
}
