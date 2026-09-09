# Testing

| Layer  | Tool                                                                   | What                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain | Vitest + fast-check                                                    | Rating engine properties (symmetry, zero-sum within a K bracket, monotonicity, expected scores sum to 1, draws between equals change nothing, `replay` is order-sensitive, `applyMatch` never mutates), plus golden values (e.g. 1200 vs 1200, K=24 → +12/−12). Effective-match overlay and leaderboard ranking/streak logic get the same treatment — fast, hundreds of cases, no I/O. |
| App/DB | Vitest against real Postgres (docker locally, service container in CI) | `recordMatch` idempotency; two concurrent `recordMatch` calls resolve to sequential `sequence` values with consistent snapshots; void after later matches replays correctly; correct changes downstream ratings; **rebuild produces byte-identical snapshots to the incremental path**; one-open-session and one-active-config constraints hold under concurrent attempts.             |
| API    | Fastify `inject`                                                       | Auth/roles, validation errors as `application/problem+json`, response shapes validated at request time by the route's own Zod schema (`fastify-type-provider-zod`'s serializer). Conformance against the committed `openapi.json` isn't wired up yet — that's step 6.                                                                                                                |
| E2E    | Playwright (post-MVP)                                                  | The 10-second record-match flow on a mobile viewport. Not part of MVP scope.                                                                                                                                                                                                                                                                                                           |

Test data comes from a small `factories.ts` (players, matches) with deterministic IDs — no faker
at MVP; determinism matters more than realism for property tests and replay-equivalence checks.

`pnpm test` runs the domain suite only (fast, no database). `pnpm test:integration` runs the
App/DB suite (needs `docker-compose.dev.yml`'s Postgres running) — each integration test _file_
gets its own fully isolated Postgres **database** (not just a schema; see the comment atop
`test/integration/helpers/test-db.ts` for why a schema-level sandbox doesn't work here), created
fresh and dropped in `afterAll`. `pnpm test:all` runs both. API-level tests (`test/api/*.test.ts`) run alongside the App/DB suite
under `test:integration` (see `vitest.integration.config.ts`), since they need the same live
Postgres and share its test-db helper.

## Why the rebuild-equals-incremental test matters most

Everything else in this codebase can be re-derived if it's wrong, because it's all downstream of
`matches` + `match_adjustments`. The one thing that must never silently drift is the claim that
"replaying from scratch gives the same answer as the incremental cache" — if that test ever
fails, the cache is lying, and every leaderboard number is suspect until it's fixed. Treat a
failure here as more urgent than any other test failure in the suite.

## CI quality gates

`eslint --max-warnings 0` (including the domain-import boundary rule), `tsc --noEmit`, `vitest`
(unit + integration, the latter against a Postgres service container), `drizzle-kit check`
(migrations in sync with the schema file), an OpenAPI diff check (fail if the committed
`openapi.json` differs from a fresh `generate:openapi` run), then a Docker build.
