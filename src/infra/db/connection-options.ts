import type postgres from 'postgres'

/**
 * postgres.js returns `bigint` (OID 20) columns as strings by default — safe in general (bigint
 * can exceed Number.MAX_SAFE_INTEGER), but our only bigint columns are matches.sequence and
 * match_adjustments.sequence, which will never realistically approach that limit for a
 * friend-group app. Parsing them as numbers here, once, at the connection layer, is simpler than
 * remembering to cast every raw SQL query that touches one — and those columns cross the JSON
 * boundary at the HTTP layer, where a bare JS BigInt can't be serialized anyway.
 */
export const postgresTypes: Record<string, postgres.PostgresType> = {
  bigint: {
    to: 20,
    from: [20],
    parse: (value: string) => Number(value),
    serialize: (value: number) => String(value),
  },
}
