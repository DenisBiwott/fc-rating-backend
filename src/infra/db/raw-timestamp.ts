/**
 * Drizzle's postgres-js driver disables postgres.js's built-in timestamp/date parsing on the
 * shared connection (it does its own schema-aware date mapping for queries built through its
 * query builder) — see drizzle-orm/postgres-js/driver.js's `construct()`, which overwrites
 * `client.options.parsers` for OIDs 1082/1083/1114/1184/etc. with an identity function. A raw
 * `db.execute(sql\`...\`)` query has no Drizzle column metadata to map with, so any timestamp
 * column it selects comes back as Postgres's text format ('2026-09-09 08:01:00.924+00'), not a
 * JS Date — unlike identical-looking columns read through `.select().from(table)`. Convert
 * explicitly wherever a raw query selects one.
 */
export function parseTimestamp(value: string): Date {
  return new Date(value)
}
