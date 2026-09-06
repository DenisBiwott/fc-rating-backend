# Architecture

## Layers

Two layers, enforced by lint rather than a framework:

```
src/
  domain/            # pure. ESLint: no imports from ../infra, ../http, drizzle, fastify
    rating/          # Elo engine + property tests
    match/           # effective-match overlay, actualScore derivation
    leaderboard/     # rank computation, form, streaks — pure over arrays
  app/               # use-cases: recordMatch, voidMatch, correctMatch, rebuildConfig,
                     # openSession, closeSession, sessionSummary, playerProfile,
                     # ratingHistory, leaderboard. Orchestrate db + domain in transactions.
                     # No HTTP knowledge.
  infra/
    db/              # drizzle schema, migrations, query modules (one file per aggregate)
    auth/            # password hashing, cookie signing
  http/
    routes/          # fastify plugins, one per resource; zod schemas here feed OpenAPI
    problem.ts       # RFC 9457 error mapping
  config.ts          # env parsing (zod)
  server.ts
test/
  unit/              # domain
  integration/       # app + db against real Postgres
  api/               # fastify inject against the full server
scripts/
  generate-openapi.ts
  seed.ts
```

Everything that isn't `domain/` may depend on anything. `domain/` may depend on nothing outside
itself — no Fastify, no Drizzle, no `node:*`, no `Date.now()`, no `Math.random()`. This is Clean
Architecture's one valuable rule (a dependency arrow that only points one way) without its four
named layers. The payoff: the rating engine and the leaderboard math are testable with plain
function calls and fast-check property tests, no database or HTTP server involved.

Use-cases in `app/` are plain functions receiving explicit dependencies —
`{ db, clock, ids, logger }` — not classes, not a DI container. If a use-case needs the current
time or a new ID, it asks for it as a parameter; tests inject deterministic fakes.

## Domain model

- **Player** — identity of a competitor. Has `isActive`. Never deleted, only deactivated.
- **Match** — immutable record of one 1v1 game: home/away player, scores, `playedAt`, optional
  session, who recorded it, and a DB-assigned `sequence` that defines rating order.
- **MatchAdjustment** — append-only correction: `void` or `correct` (with replacement
  scores/players). The _effective_ match is the original overlaid with its latest `correct`,
  unless the latest adjustment is `void`.
- **Session** — a named gaming session ("Friday Night FC"). At most one open session at a time.
- **RatingConfig** — algorithm + parameters. Exactly one is _active_ (drives the leaderboard);
  others exist for what-if replays.
- **RatingSnapshot** — per (config, match, player): rating before/after, expected score, delta. A
  cache derived by replay — droppable and rebuildable at any time.
- **User** — who can log in; has a role (`admin`/`recorder`/`viewer`). Deliberately separate from
  `Player` so per-player login can be added later without redefining what a match is.

## Derive-by-replay

The core design bet of this codebase: **ratings are never stored as truth, only recomputed.**
`rating_snapshots` is a cache keyed by `(config_id, match_id, player_id)`; the leaderboard is a SQL
view over its latest row per player. This removes an entire class of problems in one move —
there's no "corrected match, now the ratings are stale" bug, because a correction just triggers a
replay under the same lock. See [docs/DATABASE.md](DATABASE.md) for the views.

The replay input is the **effective match log**, not the raw `matches` table:

```
effective_matches(config) =
  matches
    ORDER BY sequence
    LEFT JOIN latest adjustment
    WHERE latest adjustment IS NULL OR type = 'correct'
    APPLY correction overlay
```

A void removes a match from replay but never from `matches` — history is never deleted, only
excluded from the fold. `src/domain/match` computes this overlay in pure TypeScript over arrays;
`src/infra/db` provides the equivalent as the `match_effective` SQL view for read paths that don't
need a full replay (e.g. listing history).

## Rating engine (`domain/rating`)

`RatingConfig` is a discriminated union (`{ algorithm: 'elo'; params: EloParams }` today).
`applyMatch(table, match, config)` switches on `config.algorithm` and returns a new table plus a
`MatchOutcome` — it never mutates its input. `replay(matches, config)` folds an ordered list of
effective matches from an empty table; `previewMatch` runs the same math without committing,
powering the record-match preview line.

Elo detail worth knowing before touching this code: K depends on `gamesPlayed` (provisional vs
established), so when one player is provisional and the other isn't, **deltas do not sum to
zero** — that's the one intentional source of rating inflation/deflation in the system, not a bug.

Extension seam for Glicko-2 (post-MVP): add a union variant, a module, and a `case` in
`applyMatch`. No registries, no strategy classes. Team matches (2v2, post-MVP) are folded into a
virtual 1v1 _before_ the engine sees them — the engine's signature doesn't change.

## Concurrency model

Two submissions for the same rating config must never interleave their read-modify-write of
`rating_snapshots`. Every rating-affecting use-case takes
`pg_advisory_xact_lock(hashtext(configId))` inside its transaction before reading the latest
snapshots. Two simultaneous `recordMatch` calls serialize; both succeed, in `sequence` order —
there is no retry loop because Postgres just makes the second caller wait for the lock, not fail.

A void or correct triggers a full replay of the active config's effective match log, in one
transaction, under the same lock. At friend-group scale (low thousands of matches) this is
milliseconds, so "just replay everything" beats any incremental-update scheme in both correctness
and complexity.
