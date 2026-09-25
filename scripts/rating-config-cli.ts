import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createRatingConfigBodySchema } from '../src/http/schemas/rating-config.js'

/**
 * What the two rating-config tuning scripts (evaluate-rating-configs.ts,
 * simulate-rating-configs.ts) share: the candidates file and the table printer.
 */

/**
 * Candidates use the exact body POST /rating-configs accepts, parsed by the same schema — so a
 * candidate is scored with the defaults it would be stored with, and an entry can be POSTed as-is.
 * Exits the process with the schema's errors if the file doesn't parse.
 */
export async function loadCandidates(path: string) {
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

/** Left-aligned columns, each as wide as its widest cell; the first row is the header. */
export function printTable(rows: readonly string[][]): void {
  const widths =
    rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? []
  for (const row of rows)
    console.log(row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  '))
}
