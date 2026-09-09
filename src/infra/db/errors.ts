/**
 * postgres.js attaches the raw libpq error fields to thrown errors as-is (code, constraint_name,
 * etc.) — see e.g. https://www.postgresql.org/docs/current/errcodes-appendix.html. 23505 is
 * unique_violation; checking the constraint name too avoids mis-attributing an unrelated unique
 * violation on the same table.
 *
 * Drizzle wraps this in a DrizzleQueryError when the write goes through its query builder (as
 * opposed to a raw db.execute(sql\`...\`)), with the real postgres.js error on `.cause` — so both
 * the error itself and its `.cause` need checking.
 */
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
  return (
    matchesUniqueViolation(error, constraintName) ||
    matchesUniqueViolation(hasCause(error) ? error.cause : undefined, constraintName)
  )
}

function matchesUniqueViolation(error: unknown, constraintName: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint_name' in error &&
    error.constraint_name === constraintName
  )
}

function hasCause(error: unknown): error is { cause: unknown } {
  return typeof error === 'object' && error !== null && 'cause' in error
}
