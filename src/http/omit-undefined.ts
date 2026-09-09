/**
 * Zod's `.optional()` infers a property type of `T | undefined` (the key may be present *and*
 * explicitly undefined) — but this repo's app-layer input interfaces declare optional fields as
 * `field?: T` (the key may only be *omitted*, per `exactOptionalPropertyTypes`). Route handlers
 * building a use-case's input from `request.body`/`request.query` need this conversion at the
 * boundary; app/ code itself never needs it.
 */
type StripUndefined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

export function omitUndefined<T extends Record<string, unknown>>(obj: T): StripUndefined<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value
  }
  return result as StripUndefined<T>
}
