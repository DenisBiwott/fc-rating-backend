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
**Containerized for Cloud Run, 2026-09-14** — `Dockerfile`/`.dockerignore`/`docker-entrypoint.sh`
added (build-order step 8's Docker piece; README/CI still open), `PORT` renamed from the prior
`API_PORT` drift, `src/server.ts` gained a SIGTERM/SIGINT graceful-shutdown handler, and
`scripts/migrate.ts` now runs advisory-lock-gated (`pg_advisory_lock(hashtext(...))`) so it's safe
to run automatically on every container start under Cloud Run's concurrent-cold-start model.
Verified end to end against the real (previously-empty) Neon DB — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full detail, including that Cloud Run's
continuous-deployment trigger builds straight from the root `Dockerfile` on push, so no manual
`gcloud run deploy` or image push is part of this repo's workflow. 137 tests still pass (test
suite untouched by this work — only the config/server/migrate-script changes above). **Live**:
`https://fc-rating-1067185865527.europe-west1.run.app/` (`/health` returns
`{"status":"ok","db":"ok"}`).

**Cross-origin cookie fix, 2026-09-14** — `setSessionCookie` (`src/http/plugins/auth.ts`) changed
from `sameSite: 'lax'` to `sameSite: 'none'` + `secure: true`, found while planning the frontend's
Netlify deploy: Netlify (`*.netlify.app`) and Cloud Run (`*.run.app`) are different registrable
domains, so `SameSite=Lax` — fine for local dev, where `localhost:5173`→`localhost:3000` counts as
same-site despite the port difference — would have silently withheld the session cookie on every
cross-site `fetch`/XHR once the frontend moved off `localhost`, making login appear to succeed once
and then look logged-out on every subsequent call. `Secure` cookies still work on
`http://localhost`, so no dev/prod conditional was needed. Documented in
[docs/API.md](docs/API.md#auth). Cloud Run's `CORS_ORIGIN` still needs setting to the frontend's
final Netlify URL once that exists — not done yet.

**Live database seeded for real, 2026-09-14** — the Neon DB has a real admin user, one active
`default-elo` rating config (design-doc defaults, unchanged), and one open session (`"Ongoing"`),
all verified against the live API (`/auth/me`, `/rating-configs`, `/sessions/current`). No
production-setup runbook existed before this — now documented in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#first-time-production-setup), including the
admin-password-rotation gotcha (hashed once at seed time, `db:seed` no-ops if an admin row already
exists — changing the env var later does nothing) and the safe inline-env-var pattern for running
one-off scripts against Neon without ever touching `.env`'s active local `DATABASE_URL`.
`scripts/reset-db.ts` also gained a guard, prompted by that exact risk: it now refuses to
`DROP SCHEMA ... CASCADE` against anything with `neon.tech` in its `DATABASE_URL` unless
`CONFIRM_PROD_RESET=yes` is explicitly set — verified it actually blocks (and that `db:migrate`/
`db:seed` never run after it) before touching real data. Zero players seeded on purpose — real ones
get added via `POST /players` once needed. The admin password chosen is deliberately weak
(`unguessable`, the repo's own placeholder) — flagged once, kept by explicit user choice given the
low-stakes friend-group context; worth reconsidering if that context ever changes.

**Configurable Elo refinements, 2026-09-19.** The `elo` config gained five optional, default-off
features — `expectationScale`, `goalDifferenceFactor`, `eliteK` (with hysteresis),
`repeatOpponentDamping` (per session), `maxDelta`/`ratingFloor` — read only from the config being
replayed. With all of them off the engine is bit-identical to before: asserted at `Object.is`
level in tests, and confirmed by rebuilding the dev database's 142 snapshot rows (written by the
previous code) byte for byte. Migration `0002_snapshot_elite_flag` adds
`rating_snapshots.is_elite_after`, the hysteresis state the incremental path reads back.
`POST /matches/preview` accepts an optional `sessionId`. The rebuild-equals-incremental test now
runs once per config variant (see Scars for why the old one proved nothing). Adopted in
production as `tuned-elo-v1`: on 2026-09-25 `ratings:evaluate` found it predicting identically to
the `elo-tuned-v1` candidate on all 117 matches (paired difference exactly 0; params not compared
directly). There's still no activate endpoint — adopting a config means inserting it, flipping
`is_active` by hand, and rebuilding. 265 tests pass (was 137).

**Turn 3 contract additions, 2026-09-23** (for the frontend's desktop/tablet/TV work — see
`fc-rating-frontend/CLAUDE.md`). `GET /players` list items gained `createdAt` (already on the row,
no new query — the roster table's Joined column). `GET /matches` items gained a nullable `outcome`
(the same `matchOutcomeSchema` and null-when-voided rule `GET /matches/:id` already used — TV
mode's per-match deltas and UPSET badge), one batched snapshot query per page.
`outcomesByMatchId` (`src/app/reconstruct-outcome.ts`) groups snapshot rows by match and rebuilds
each outcome; `sessionSummary` now uses it instead of its own copy of that loop. 166 unit + 114
API/integration tests pass.

Build order lives in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The product/UI design lives in
`../DESIGN-SPEC.md` (one directory up, outside this repo — a planning document, not committed
here); the original data/API design doc is retired, so this repo's docs, schema and
`openapi.json` are the source of truth for data and behaviour. This repo's docs are a distillation of the sections
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
format (`'2026-09-09 08:01:00.924+00'`), not a JS `Date`— unlike an identical-looking column
read through`.select().from(table)`. Convert explicitly with `src/infra/db/raw-timestamp.ts`'s
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
- **A rebuild-equals-incremental scenario that ends in a void/correct proves nothing.**
  `voidMatch`/`correctMatch` run `replayAndPersist`, which deletes and rewrites every snapshot row
  for the config — so the original test (record, void, record, correct, then compare against
  `rebuildConfig`) compared a replay with a replay, and still passed with home/away scores swapped
  on the incremental path. Scenarios must record matches after their last adjustment;
  `test/integration/rebuild-equals-incremental.test.ts` asserts such incrementally written rows
  exist before it compares anything.

## Scope boundaries

Deliberately not modelled at MVP — flag rather than silently design around these: `Season`,
`MatchParticipant` (2v2), `Team`, achievements, Glicko-2 (the `RatingConfig` union has exactly one
variant, `elo`), per-player login/OAuth (`users` stays separate from `players` for exactly this
reason). See design doc §13 for the intended order if one of these becomes real work. Margin of
victory exists only as the optional, default-off `goalDifferenceFactor` on the `elo` config.
Rating stays a pure function of config + effective match log, so no rating decay or other
wall-clock input — it would break replay determinism.

## Process rules

- **Documentation updates.** When a change makes an existing doc claim wrong, or adds something a
  doc is supposed to cover, the doc update is part of that change. Trigger on: a change to a
  route/contract, a schema change or new migration, a new/changed env var, a change to an
  architectural rule or a previously-deferred decision, or a scar-worthy fix. **Always propose
  before editing a doc**: state which doc(s), quote the lines, show the replacement, and wait for
  a go-ahead — never edit a doc as a silent side effect of a code change.
- **The Postman collection is maintained alongside the docs.** `postman/` (the collection plus
  Local/Production environments) is generated from `openapi.json` by `scripts/generate-postman.ts`,
  and `pnpm generate:openapi` regenerates both. Any change to a route, a request/response shape, or
  a documented procedure that uses them (e.g. `docs/RATING_CONFIGS.md`) ships the regenerated
  `postman/` in the same change. A new request body needs an example in the generator's `BODIES`;
  generation fails without one, and fails if an example stops matching its Zod schema. Never
  hand-edit `postman/*.json`. `pnpm generate:postman:check` fails if it's stale. See
  [docs/POSTMAN.md](docs/POSTMAN.md).
- Each topic has exactly one owning doc; update the owner rather than restating the fact
  elsewhere. Prefer no doc over a volatile one — don't hand-maintain an exhaustive route list or
  schema dump here; point at the code (or `openapi.json`) instead.
- Keep SQL readable: one query module per aggregate under `src/infra/db/queries`, no query
  builders inside route handlers.
- No comments that restate code. Do comment the asymmetric-K rating-inflation note and the
  advisory-lock rationale where they land in code — they're non-obvious.

## Where to look

| Doc                                              | Read it when                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)     | Layer boundaries, domain model, effective-match/replay design, concurrency model                |
| [docs/DATABASE.md](docs/DATABASE.md)             | Schema, constraints, views, migrations, seeds                                                   |
| [docs/API.md](docs/API.md)                       | Routes, auth/roles, error format, idempotency contract                                          |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)       | Local setup, build order, scripts, running tests                                                |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md)   | Env vars                                                                                        |
| [docs/TESTING.md](docs/TESTING.md)               | Testing strategy per layer, CI quality gates                                                    |
| [docs/RATING_CONFIGS.md](docs/RATING_CONFIGS.md) | Evaluating candidate rating configs (`pnpm ratings:evaluate`, `ratings:simulate`), adopting one |
| [docs/POSTMAN.md](docs/POSTMAN.md)               | Importing and using the Postman collection, keeping it generated                                |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)         | Docker Compose, VPS, migrations, backups                                                        |
