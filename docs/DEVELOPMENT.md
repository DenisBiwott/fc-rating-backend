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
prompt so the reasoning survives past the first session). Steps 1–4 are done; step 5 is next.

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
5. **Next.** HTTP — Fastify routes, Zod schemas, cookie auth, RFC 9457 errors, pino request
   logging, `/health`. Nothing in this repo is reachable over the network until this step.
6. `scripts/generate-openapi.ts` → commit `openapi.json` at the repo root. This is the point the
   frontend repo can start consuming a real contract instead of a hand-stubbed one.
7. API tests (`fastify.inject`) for auth, roles, validation, and response-shape conformance to
   `openapi.json`.
8. README, Docker, CI.

Commit after each numbered step — each is independently reviewable and the domain/database/API
layers are genuinely separable pieces of learning.

## Local loop

```
docker compose -f docker-compose.dev.yml up -d --wait   # postgres:16
pnpm install
pnpm db:migrate
pnpm db:seed                       # idempotent — safe to re-run
pnpm lint && pnpm typecheck && pnpm test              # fast, no database needed
pnpm test:integration                                 # needs the postgres container running
pnpm test:all                                         # both, in sequence
```

`pnpm dev` doesn't exist yet — there's no HTTP server until step 5. Until then, use-cases are only
reachable from a script or a test (`test/integration/helpers/deps.ts` shows how to wire `Deps`).

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
