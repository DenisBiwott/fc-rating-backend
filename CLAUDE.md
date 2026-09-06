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

**Status:** pre-scaffold — no code yet. Build order lives in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The full product/data/API design lives in
`../fc-rating-platform-design.md` (one directory up, outside this repo — a planning document, not
committed here). This repo's docs are a distillation of the sections that govern it; if the two
ever disagree, treat that as a bug in this repo's docs and flag it rather than silently trusting
one side.

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

None yet — this is a greenfield repo. When a bug's fix is non-obvious (the straightforward version
looks right but is wrong for a reason that isn't visible in the code), it goes here as a one-line
prohibition + why, with the mechanism in the relevant topic doc.

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
