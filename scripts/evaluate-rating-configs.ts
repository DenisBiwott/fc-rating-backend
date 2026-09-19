import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { evaluateRatingConfigs, type ConfigEvaluation } from '../src/app/evaluate-rating-configs.js'
import { COIN_FLIP_SCORE } from '../src/domain/rating/evaluation.js'
import { createRatingConfigBodySchema } from '../src/http/schemas/rating-config.js'
import { systemClock } from '../src/infra/clock.js'
import { createDbClient } from '../src/infra/db/client.js'
import { systemIds } from '../src/infra/ids.js'
import { consoleLogger } from '../src/infra/logger.js'

/**
 * Scores every stored rating config — plus any candidates in a JSON file — against the full
 * effective match log. Read-only by construction (see evaluateRatingConfigs), so it's safe to run
 * against production. Usage and how to read the output: docs/RATING_CONFIGS.md.
 *
 *   pnpm ratings:evaluate [candidates.json]
 */

const databaseUrl = process.env.DATABASE_URL
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first.')
}

// Candidates use the exact body POST /rating-configs accepts, parsed by the same schema — so a
// candidate is scored with the defaults it would be stored with, and an entry can be POSTed as-is.
async function loadCandidates(path: string | undefined) {
  if (path === undefined) return []
  const parsed = z
    .array(createRatingConfigBodySchema)
    .safeParse(JSON.parse(await readFile(path, 'utf8')))
  if (!parsed.success) {
    console.error(
      `${path} isn't a list of valid rating-config bodies:\n${z.prettifyError(parsed.error)}`,
    )
    process.exit(1)
  }
  return parsed.data
}

const fixed = (value: number | null, digits = 4) => (value === null ? '—' : value.toFixed(digits))

function vsActiveColumn(evaluation: ConfigEvaluation): string {
  if (evaluation.source === 'active') return '(active)'
  if (evaluation.vsActive === null) return '—'
  const { difference, standardError } = evaluation.vsActive
  const sign = difference > 0 ? '+' : ''
  const verdict =
    Math.abs(difference) <= 2 * standardError ? 'noise' : difference < 0 ? 'better' : 'worse'
  return `${sign}${difference.toFixed(4)} ± ${(2 * standardError).toFixed(4)}  ${verdict}`
}

function printTable(rows: readonly string[][]): void {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? []
  for (const row of rows)
    console.log(row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  '))
}

const candidates = await loadCandidates(process.argv[2])
const target = new URL(databaseUrl)
const db = createDbClient(databaseUrl)

try {
  const { matchCount, evaluations } = await evaluateRatingConfigs(
    { db, clock: systemClock, ids: systemIds, logger: consoleLogger },
    candidates,
  )

  console.log(`\nDatabase: ${target.hostname}${target.pathname} (read-only)`)
  console.log(`Matches: ${String(matchCount)} in the effective log`)
  console.log(
    `Lower is better. A coin flip scores Brier ${COIN_FLIP_SCORE.brier.toFixed(4)}, ` +
      `log loss ${COIN_FLIP_SCORE.logLoss.toFixed(4)}.\n`,
  )
  printTable([
    ['config', 'source', 'Brier', 'log loss', 'Brier (established)', 'vs active (± 2 SE)'],
    ...evaluations.map((evaluation) => [
      evaluation.name,
      evaluation.source,
      fixed(evaluation.all.brier),
      fixed(evaluation.all.logLoss),
      `${fixed(evaluation.established.brier)} (${String(evaluation.established.matches)})`,
      vsActiveColumn(evaluation),
    ]),
  ])
  if (matchCount === 0) console.log('\nNo matches yet — nothing to score.')
} finally {
  await db.$client.end()
}
