# CLAUDE.md — FC Rating API

This file is the authoritative, always-loaded context for working in this repo. It holds only
what must never be silently dropped: non-negotiables, scope boundaries, and process rules.
Everything else — how things work, why, current setup — lives in `docs/` and is linked at the
bottom. Read it fully before writing code.

## What this is

Backend for an internal competitive rating platform (Elo-based) for a friend group playing EA
Sports FC. Node 22 + TypeScript strict + Fastify + Drizzle ORM + PostgreSQL 16. Solo,
production-quality modular monolith, built as an engineering-learning project: correctness over
speed, explicit over implicit, derived over cached, no premature infrastructure.

**Status:** domain layer, database schema, every app-layer use-case (`recordMatch`,
`previewMatch`, `leaderboard`, `voidMatch`, `correctMatch`, `rebuildConfig`, `openSession`,
`closeSession`, `sessionSummary`, `playerProfile`, `ratingHistory`), the full HTTP layer (Fastify
routes, Zod schemas, cookie auth, RFC 9457 errors), and `openapi.json` generation
(`scripts/generate-openapi.ts`, via `@fastify/swagger` + `fastify-type-provider-zod`) are built and
tested against a live Postgres — build-order steps 1–6. Every route in the design doc's §6 table
has a working endpoint and a generated OpenAPI 3.1 entry; run `pnpm dev` and the API is reachable,
or `pnpm generate:openapi` to regenerate the committed contract. `pnpm generate:openapi:check`
fails if the committed file is stale, but isn't wired into CI yet — no `.github/` directory exists;
that's step 8. **Not started: response-shape conformance tests against the committed
`openapi.json`** (step 7). Verified for real against a running frontend dev server (not just
`curl`/tests): the API had **no CORS configuration at all**, so every cross-origin request from
the frontend's dev origin failed outright, the cookie never set — fixed by registering
`@fastify/cors` with an allow-listed `CORS_ORIGIN` (default `http://localhost:5173`) and
`credentials: true` (`src/http/build-app.ts`). A genuine backend gap, not a frontend workaround.
`GET /players/:id` also gained `bestStreak`/`goalsFor`/`goalsAgainst` (siblings to the existing
`currentStreak` derivation in `src/domain/leaderboard/compute.ts` and `src/domain/match/result.ts`
— reuse data `playerProfile()` already loads, no new query) and `createdAt`; `GET /players` gained
`lastPlayedAt` (`lastPlayedAtByPlayer` in `src/infra/db/queries/match-effective.ts`, a
`MAX(played_at)` across `match_effective`, one new query) — both added for the frontend's
player-profile/roster screens (`fc-rating-frontend/CLAUDE.md`'s Phase 4). 115 tests pass (was 106).
**2026-09-10 build, all shipped except the access-model change (below):** `rankPlayers()`
(`src/domain/leaderboard/compute.ts`) now sorts strictly-0-game players to the bottom regardless
of rating — provisional (1-9 game) players are unaffected. `DELETE /players/:id` (admin) hard-
deletes a player, gated on a genuine "has this player ever appeared in `matches`" check
(`playerHasMatches`, `src/infra/db/queries/matches.ts`) rather than the replay-derived
`gamesPlayed` counter — a player whose only match was later voided shows `gamesPlayed: 0` but
still has a permanent row in the append-only `matches` table (FK, no cascade), so the literal-
row check is what avoids a raw FK-violation 500 instead of a clean 409; `player-profile.ts`'s
comment and `docs/ARCHITECTURE.md#domain-model` now read "never deleted once they've played,"
not an absolute. `GET /matches/:id/void-preview` (admin) is a genuine new capability — a pure,
non-persisting replay (same shape as `what-if-leaderboard.ts`) that simulates voiding a match by
excluding it from the effective log fed to `replay()`; `diffRanks` moved out of `record-match.ts`
into `replay.ts` so both the real record path and this preview share one rank-diffing
implementation. Also found and fixed: `@fastify/cors` defaults `methods` to `GET,HEAD,POST` only
— PATCH/DELETE 405'd at the browser's preflight, latent since every prior cross-origin
verification only exercised GET/POST; now explicit
(`methods: ['GET','POST','PATCH','DELETE']`, `src/http/build-app.ts`). 128 tests pass (was 115).
**Public-viewing access model shipped 2026-09-10.** Dropped `requireRole('viewer')` (and the
now-inapplicable `security: sessionCookie` schema entries) from every GET route in
`leaderboard.ts`/`players.ts`/`matches.ts`/`sessions.ts` — leaderboard, players, profiles, rating
history, player matches, and match/session listings are all readable with no session. Every
mutation route is exactly as gated as before; `GET /matches/:id/void-preview` and every
`GET /rating-configs` route stay admin-gated deliberately (part of the admin workflow / tuning
data, not a public read) — new tests lock in both exceptions alongside the newly-public routes.
136 tests pass (was 115).
**MVP simplification pass, 2026-09-14.** `POST /auth/login` is now rate-limited (5 attempts / 15
min per IP, `@fastify/rate-limit` registered with `global: false` in `src/http/build-app.ts` so no
other route is affected) — the shared admin password had zero throttling, a real gap once the
public-viewing change means anyone can reach `/login`. Its `errorResponseBuilder` throws a new
`RateLimitExceededError` rather than hand-formatting a reply, so a 429 flows through the same
`errorMappings`/`registerErrorHandler` pipeline (`src/http/plugins/error-handler.ts`) every other
typed error already uses. 137 tests pass (was 136). Also decided, not built here: this repo needs
**no other backend changes** for the frontend's session-management/match-history simplification
(sessions stay exactly as built — `sessionId` was already optional on `recordMatch`; "one
long-running session" is a one-time out-of-band `POST /sessions` call, not new product code) and
void already has everything the frontend needs (`POST /matches/:id/void`,
`GET /matches/:id/void-preview`) — see `fc-rating-frontend/CLAUDE.md` for what's changing there.

Build order lives in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The
full product/
data/API design lives in `../fc-rating-platform-design.md` (one directory up, outside this repo —
a planning document, not committed here). This repo's docs are a distillation of the sections
that govern it; if the two ever disagree, treat that as a bug in this repo's docs and flag it
rather than silently trusting one side.

## Non-negotiables

- **Matches are immutable and append-only. Ratings are DERIVED by replaying matches through a
  rating config.** `rating_snapshots` is a rebuildable cache, never a source of truth. Never add a
  `winner`, `streak`, or any other column whose value is computable from `matches` +
  `match_adjustments`.
- **`src/domain/**` has zero dependencies on Fastify, Drizzle, `postgres`, pino, `node:*`, or
  anything under `src/infra`/`src/app`/`src/http`.** Enforced by an ESLint `no-restricted-imports`
  rule that must never be weakened or suppressed inline. Domain functions are pure: no I/O, no
  `Date`, no randomness, never mutate their inputs.
- **`matches.sequence` (Postgres `GENERATED ALWAYS AS IDENTITY`) is the only ordering that matters
  for rating replay.** `playedAt` is client-supplied and display-only — never sort or replay by it.
- Rating calculation is synchronous inside the match-insert transaction; deltas are returned in
  the same response. No async projections, no queues.
- Every rating-affecting write (`recordMatch`, `voidMatch`, `correctMatch`, `rebuildConfig`) runs
  inside one `db.transaction`, serialized with `pg_advisory_xact_lock(hashtext(configId))`.
- IDs are UUID v7. Match `id` is client-generated and is the idempotency key — `POST /matches`
  with a previously-seen `id` returns 200 with the original result, not an error. Everything else
  is server-generated through an injectable `ids` dependency so tests are deterministic.
- Do **not** introduce: NestJS or any DI container/decorators, Prisma or TypeORM, class-validator,
  Express, an event store, message queues, or Testcontainers (use `docker-compose.dev.yml` locally
  and a GitHub Actions Postgres service container in CI).
- `openapi.json` is generated from the Zod route schemas, never hand-edited. It is the contract
  the frontend repo consumes — a breaking change starts with a Zod schema change here, not the
  other way round.

## Scars

- **`match_effective`'s `is_void` column needs `coalesce(a.type = 'void', false)`, never a bare
  `a.type = 'void'`.** When a match has no adjustment, `a.type` is `null`, and `null = 'void'`
  evaluates to `null` — so a bare `WHERE not is_void` silently excludes every never-adjusted match
  (almost all of them), not just void ones. Copied verbatim from the design doc's own SQL, which
  has the same bug. See `src/infra/db/migrations/0001_views.sql`.
- **A write through Drizzle's query builder (not a raw `db.execute(sql\`...\`)`) that violates a
constraint throws `DrizzleQueryError`, not the underlying `PostgresError`.** The real error —
`.code`, `.constraint_name`, etc. — is on `.cause`. Code that branches on a Postgres error code
(see `src/infra/db/errors.ts`'s `isUniqueViolation`) must check both the error and `.cause`.
- **postgres.js returns `bigint` columns as JS strings by default**, not numbers — silent until
  something does a typed numeric comparison (`toBeLessThan`, etc.) rather than arithmetic (which
  coerces). Fixed at the connection layer (`src/infra/db/connection-options.ts`) for
  `matches.sequence`/`match_adjustments.sequence`, the only bigint columns in this schema and both
  safely within `Number` range for this app's scale — don't reintroduce a raw connection that skips
  this config.
- **A Fastify preHandler must be `async` (or otherwise return a thenable), never a plain
  synchronous function returning `void`.** Fastify's hook runner only advances the chain by
  awaiting a returned promise or invoking the hook's `done` callback — a sync function that
  returns `undefined` does neither, so the chain silently stalls forever on the success path. The
  failure path can look deceptively fine: calling `reply.send()` finishes the HTTP response
  directly, independent of the hook chain, so a preHandler's 401/403 branch "works" while its
  success branch (falling through to the route handler) hangs every request. See
  `src/http/plugins/auth.ts`'s `requireRole`.
- **Drizzle's postgres-js driver disables postgres.js's built-in timestamp/date parsing on the
  shared connection** (`drizzle-orm/postgres-js/driver.js`'s `construct()` overwrites
  `client.options.parsers` for date/time OIDs with an identity function, so its own query builder
  can do schema-aware date mapping instead). A raw `db.execute(sql\`...\`)` query has no Drizzle
  column metadata to map with, so any timestamp column it selects comes back as Postgres's text
  format (`'2026-09-09 08:01:00.924+00'`), not a JS `Date` — unlike an identical-looking column
  read through `.select().from(table)`. Convert explicitly with `src/infra/db/raw-timestamp.ts`'s
  `parseTimestamp()` wherever a raw query selects one.
- **A route registered synchronously (a bare `app.get()`/`app.post()`) runs before any pending
  `app.register(...)` plugin's body has executed.** Fastify's `onRoute` hooks fire once, at the
  moment a route is added, over whatever hooks already exist at that instant — they never fire
  retroactively. `app.register(...)` (including `@fastify/swagger`, which attaches its `onRoute`
  hook from inside its own plugin body) is deferred to avvio's boot queue rather than run inline,
  so a route added in the same synchronous tick — even textually after the `register(...)` call —
  is invisible to a hook that plugin hasn't attached yet. The route itself still works
  (`app.printRoutes()` shows it, real requests are served correctly); only anything depending on
  `onRoute` firing (schema collection for `app.swagger()`, here) silently sees nothing. Fixed by
  wrapping route registration in `app.after(...)`, which defers until every plugin registered
  above it has finished loading. See `src/http/build-app.ts`.

## Scope boundaries

Deliberately not modelled at MVP — flag rather than silently design around these: `Season`,
`MatchParticipant` (2v2), `Team`, achievements, Glicko-2 (the `RatingConfig` union has exactly one
variant, `elo`), margin-of-victory scoring, per-player login/OAuth (`users` stays separate from
`players` for exactly this reason). See design doc §13 for the intended order if one of these
becomes real work.

## Process rules

- **Documentation updates.** When a change makes an existing doc claim wrong, or adds something a
  doc is supposed to cover, the doc update is part of that change. Trigger on: a change to a
  route/contract, a schema change or new migration, a new/changed env var, a change to an
  architectural rule or a previously-deferred decision, or a scar-worthy fix. **Always propose
  before editing a doc**: state which doc(s), quote the lines, show the replacement, and wait for
  a go-ahead — never edit a doc as a silent side effect of a code change.
- Each topic has exactly one owning doc; update the owner rather than restating the fact
  elsewhere. Prefer no doc over a volatile one — don't hand-maintain an exhaustive route list or
  schema dump here; point at the code (or `openapi.json`) instead.
- Keep SQL readable: one query module per aggregate under `src/infra/db/queries`, no query
  builders inside route handlers.
- No comments that restate code. Do comment the asymmetric-K rating-inflation note and the
  advisory-lock rationale where they land in code — they're non-obvious.

## Where to look

| Doc                                            | Read it when                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)   | Layer boundaries, domain model, effective-match/replay design, concurrency model |
| [docs/DATABASE.md](docs/DATABASE.md)           | Schema, constraints, views, migrations, seeds                                    |
| [docs/API.md](docs/API.md)                     | Routes, auth/roles, error format, idempotency contract                           |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)     | Local setup, build order, scripts, running tests                                 |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Env vars                                                                         |
| [docs/TESTING.md](docs/TESTING.md)             | Testing strategy per layer, CI quality gates                                     |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)       | Docker Compose, VPS, migrations, backups                                         |
