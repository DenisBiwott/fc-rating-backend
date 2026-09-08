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
