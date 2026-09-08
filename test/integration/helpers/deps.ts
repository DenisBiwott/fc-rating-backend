import type { Database, Deps } from '../../../src/app/types.js'
import { systemIds } from '../../../src/infra/ids.js'

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined }

export function testDeps(db: Database, overrides: Partial<Deps> = {}): Deps {
  return {
    db,
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z') },
    ids: systemIds,
    logger: silentLogger,
    ...overrides,
  }
}
