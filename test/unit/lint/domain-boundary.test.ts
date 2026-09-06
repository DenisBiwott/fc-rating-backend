import { ESLint } from 'eslint'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Exercises the real eslint.config.js against throwaway fixture files, rather than introspecting
 * the config object, so this test fails the moment the domain-import boundary stops actually
 * blocking anything — not just when its shape in eslint.config.js changes. See
 * fc-rating-backend/docs/ARCHITECTURE.md#layers.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

let fixtureDir: string | undefined

afterEach(() => {
  if (fixtureDir !== undefined) {
    rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = undefined
  }
})

async function restrictedImportRuleIds(relativeDir: string, source: string): Promise<string[]> {
  fixtureDir = mkdtempSync(join(repoRoot, `${relativeDir}/__fixture_`))
  const filePath = join(fixtureDir, 'fixture.ts')
  writeFileSync(filePath, source)

  const eslint = new ESLint({ cwd: repoRoot })
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message)
}

describe('domain import boundary', () => {
  it('flags a Fastify import from within src/domain', async () => {
    const messages = await restrictedImportRuleIds(
      'src/domain',
      "import fastify from 'fastify'\nvoid fastify\n",
    )
    expect(messages.length).toBeGreaterThan(0)
  })

  it('flags reaching into ../infra from within src/domain', async () => {
    const messages = await restrictedImportRuleIds(
      'src/domain',
      "import { db } from '../infra/db/client.js'\nvoid db\n",
    )
    expect(messages.length).toBeGreaterThan(0)
  })

  it('does not flag the same Fastify import outside src/domain', async () => {
    const messages = await restrictedImportRuleIds(
      'test/unit/lint',
      "import fastify from 'fastify'\nvoid fastify\n",
    )
    expect(messages).toHaveLength(0)
  })
})
