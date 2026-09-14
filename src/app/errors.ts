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

export class PlayerNotFoundError extends Error {
  constructor(playerId: string) {
    super(`Player not found: ${playerId}`)
    this.name = 'PlayerNotFoundError'
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

export class SessionAlreadyClosedError extends Error {
  constructor(sessionId: string) {
    super(`Session already closed: ${sessionId}`)
    this.name = 'SessionAlreadyClosedError'
  }
}

export class SessionAlreadyOpenError extends Error {
  constructor() {
    super('A session is already open — close it before opening another (see sessions_one_open).')
    this.name = 'SessionAlreadyOpenError'
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid password.')
    this.name = 'InvalidCredentialsError'
  }
}

export class RateLimitExceededError extends Error {
  constructor(retryAfter: string) {
    super(`Too many login attempts. Try again in ${retryAfter}.`)
    this.name = 'RateLimitExceededError'
  }
}

export class PlayerNameConflictError extends Error {
  constructor(name: string) {
    super(`A player named "${name}" already exists.`)
    this.name = 'PlayerNameConflictError'
  }
}

export class PlayerHasMatchesError extends Error {
  constructor(playerId: string) {
    super(`Player ${playerId} has matches and cannot be deleted.`)
    this.name = 'PlayerHasMatchesError'
  }
}

export class RatingConfigNameConflictError extends Error {
  constructor(name: string) {
    super(`A rating config named "${name}" already exists.`)
    this.name = 'RatingConfigNameConflictError'
  }
}
