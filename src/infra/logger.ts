/**
 * Structurally compatible with pino.Logger's (msg, meta?) call shape, so the HTTP layer (step 5)
 * can inject a real pino instance here with no change to app/ code. consoleLogger is a placeholder
 * until then.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export const consoleLogger: Logger = {
  info: (message, meta) => {
    console.log(message, meta ?? {})
  },
  warn: (message, meta) => {
    console.warn(message, meta ?? {})
  },
  error: (message, meta) => {
    console.error(message, meta ?? {})
  },
}

/** pino's `LogFn` puts the merging object first (`logger.info(meta, message)`), the reverse of
 * this file's `(message, meta)` order — this adapter is the "real pino instance" this file's own
 * doc comment refers to, not a bare assignment. */
export interface PinoLike {
  info(meta: Record<string, unknown>, message: string): void
  warn(meta: Record<string, unknown>, message: string): void
  error(meta: Record<string, unknown>, message: string): void
}

export function fromPino(pino: PinoLike): Logger {
  return {
    info: (message, meta) => {
      pino.info(meta ?? {}, message)
    },
    warn: (message, meta) => {
      pino.warn(meta ?? {}, message)
    },
    error: (message, meta) => {
      pino.error(meta ?? {}, message)
    },
  }
}
