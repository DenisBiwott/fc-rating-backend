# Development

## Prerequisites

- Node 22 (confirmed installed: `node -v`).
- pnpm via Corepack (bundled with Node 22, not installed globally yet) — run `corepack enable`
  once, then `pnpm` resolves per the `packageManager` field once `package.json` exists. Don't
  `npm install -g pnpm`; Corepack keeps the version pinned per-repo.
- Docker Desktop running locally, for `docker-compose.dev.yml` (Postgres 16 on `5432` — confirmed
  free on this machine).

## Build order

This repo is scaffolded from scratch, in commits, in this order (mirrors the original scaffold
prompt so the reasoning survives past the first session). Steps 1–6 are done; step 7 is next.

1. **Done.** Tooling — `tsconfig` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`),
   ESLint flat config with the domain-import boundary rule (see
   [ARCHITECTURE.md](ARCHITECTURE.md#layers)), Prettier. A test that fails if the boundary rule is
   ever removed or weakened.
2. **Done.** Domain — `src/domain/rating` (Elo), `src/domain/match` (effective-match overlay),
   `src/domain/leaderboard` (rank/form/streak/provisional). Fast-check properties + golden tests.
   100% coverage.
3. **Done.** Database — Drizzle schema + a hand-written migration for the two views (see
   [DATABASE.md](DATABASE.md)), matching every constraint. Seeds.
   `db:generate`/`db:migrate`/`db:seed`/`db:reset`.
4. **Done.** App use-cases (`src/app/*.ts`) — plain functions over `{ db, clock, ids, logger }`,
   integration-tested against a real Postgres database per test file (see
   [TESTING.md](TESTING.md)).
5. **Done.** HTTP — Fastify routes, Zod schemas, cookie auth, RFC 9457 errors, pino request
   logging, `/health`. Every route in the design doc's §6 table has a working endpoint —
   `pnpm dev` reaches all of it. API-level tests (`test/api/*.test.ts`, `fastify.inject`) for
   auth, roles, and validation landed alongside each route group rather than as a separate step
   — see [TESTING.md](TESTING.md).
6. **Done.** `scripts/generate-openapi.ts` (via `@fastify/swagger` +
   `fastify-type-provider-zod`'s `jsonSchemaTransform`) generates `openapi.json` at the repo
   root — 21 paths, 26 operations, unique `operationId`s, `security: [{ sessionCookie: [] }]` on
   every role-gated route — and it's committed. `pnpm generate:openapi:check` compares a fresh
   generate against the committed file (no write) but isn't wired into CI yet — that's step 8.
   This is the point the frontend repo started consuming a real contract instead of a
   hand-stubbed one.
7. **Next.** Response-shape conformance tests against the committed `openapi.json`.
8. README, Docker, CI. **Docker done** (2026-09-14) — `Dockerfile`, `.dockerignore`,
   `docker-entrypoint.sh`; see [DEPLOYMENT.md](DEPLOYMENT.md). README and CI (including wiring
   `generate:openapi:check` into a PR workflow) still open.

Commit after each numbered step — each is independently reviewable and the domain/database/API
layers are genuinely separable pieces of learning.

## Local loop

```
docker compose -f docker-compose.dev.yml up -d --wait   # postgres:16
pnpm install
pnpm db:migrate
pnpm db:seed                       # idempotent — safe to re-run
pnpm dev                                              # Fastify on $PORT (default 3000), watches for changes
pnpm lint && pnpm typecheck && pnpm test              # fast, no database needed
pnpm test:integration                                 # needs the postgres container running (also runs test/api/*)
pnpm test:all                                         # both, in sequence
```

`pnpm dev` needs `.env` copied from `.env.example` first (see [CONFIGURATION.md](CONFIGURATION.md)
for what each var does) — `src/config.ts` fails fast at startup if one's missing or malformed.

If Postgres was already running and something looks wrong (a stale migration, leftover data from
manual `psql` poking), `pnpm db:reset` drops and recreates everything cleanly — see the scar about
`__drizzle_migrations` bookkeeping in the root `CLAUDE.md` if `db:reset` ever silently no-ops.

**If your editor shows syntax errors on `src/infra/db/migrations/*.sql`** ("CREATE VIEW must be
the only statement in the batch", "Expecting '(' or SELECT" near `DISTINCT ON`, etc.) — that's a
T-SQL (SQL Server) linter, most likely the `mssql` VS Code extension, misparsing Postgres-only
syntax (`DISTINCT ON`, `JOIN ... USING`). The SQL is correct; `.vscode/settings.json` maps
migration files to plain text so the T-SQL validator stops claiming them.

## Regenerating the contract

`pnpm generate:openapi` regenerates `openapi.json` from the live Zod route schemas. Run it
whenever a route, request, or response schema changes, and commit the diff in the same PR as the
schema change — CI fails if the committed file is stale relative to the generated output.
