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
prompt so the reasoning survives past the first session):

1. Tooling — `tsconfig` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint
   flat config with the domain-import boundary rule (see
   [ARCHITECTURE.md](ARCHITECTURE.md#layers)), Prettier. A test that fails if the boundary rule is
   ever removed or weakened.
2. Domain — `src/domain/rating` (Elo), `src/domain/match` (effective-match overlay),
   `src/domain/leaderboard` (rank/form/streak/provisional). Fast-check properties + golden tests.
   Target 100% coverage — it's pure, so there's no excuse not to.
3. Database — Drizzle schema + raw-SQL migration matching [DATABASE.md](DATABASE.md) exactly,
   including every constraint and both views. Seeds. `db:generate`/`db:migrate`/`db:seed`/`db:reset`.
4. App use-cases — plain functions over `{ db, clock, ids, logger }`.
5. HTTP — Fastify routes, Zod schemas, cookie auth, RFC 9457 errors, pino request logging,
   `/health`.
6. `scripts/generate-openapi.ts` → commit `openapi.json` at the repo root. This is the point the
   frontend repo can start consuming a real contract instead of a hand-stubbed one.
7. Integration tests against real Postgres.
8. API tests (`fastify.inject`) for auth, roles, validation, and response-shape conformance to
   `openapi.json`.
9. README, Docker, CI.

Commit after each numbered step — each is independently reviewable and the domain/database/API
layers are genuinely separable pieces of learning.

## Local loop

Once scaffolded:

```
docker compose -f docker-compose.dev.yml up -d   # postgres:16
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                                          # serves /api/v1
pnpm lint && pnpm typecheck && pnpm test
```

## Regenerating the contract

`pnpm generate:openapi` regenerates `openapi.json` from the live Zod route schemas. Run it
whenever a route, request, or response schema changes, and commit the diff in the same PR as the
schema change — CI fails if the committed file is stale relative to the generated output.
