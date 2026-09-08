/** Injected wherever "now" is needed, so tests can freeze time instead of racing the system clock. */
export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
