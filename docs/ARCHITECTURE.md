# Architecture

## Layers

Two layers, enforced by lint rather than a framework:

```
src/
  domain/            # pure. ESLint: no imports from ../infra, ../http, drizzle, fastify
    rating/          # Elo engine + property tests
    match/           # effective-match overlay, actualScore derivation
    leaderboard/     # rank computation, form, streaks — pure over arrays
  app/               # use-cases (one file per use-case) + a few shared helpers (validation,
                     # outcome reconstruction, the replay-and-persist primitive void/correct/
                     # rebuild all share). Explicit deps: { db, clock, ids, logger }. No HTTP
                     # knowledge. Current use-case list is authoritative in the code, not here —
                     # see src/app/*.ts.
  infra/
    db/              # drizzle schema, migrations, query modules (one file per aggregate)
    auth/            # password hashing
    ids.ts, clock.ts, logger.ts, errors.ts   # injectable deps + Postgres error translation
  http/              # Fastify routes, Zod schemas, RFC 9457 errors, cookie auth (step 5, done)
scripts/
  migrate.ts, seed.ts, reset-db.ts
  generate-openapi.ts   # done — step 6; produces the committed openapi.json at the repo root
test/
  unit/              # domain, plus the lint-boundary behavioral test
  integration/       # app + db, one fresh Postgres *database* per test file (see helpers/test-db.ts)
  api/                # fastify inject against the full server (step 5, done) — one file per route group
```

The layout above is the stable shape (what each top-level folder is _for_); read the directory
itself for the current, exact file list — a hand-maintained enumeration here would just go stale
again the moment the next use-case or query module is added.

Everything that isn't `domain/` may depend on anything. `domain/` may depend on nothing outside
itself — no Fastify, no Drizzle, no `node:*`, no `Date.now()`, no `Math.random()`. This is Clean
Architecture's one valuable rule (a dependency arrow that only points one way) without its four
named layers. The payoff: the rating engine and the leaderboard math are testable with plain
function calls and fast-check property tests, no database or HTTP server involved.

Use-cases in `app/` are plain functions receiving explicit dependencies —
`{ db, clock, ids, logger }` — not classes, not a DI container. If a use-case needs the current
time or a new ID, it asks for it as a parameter; tests inject deterministic fakes.

## Domain model

- **Player** — identity of a competitor. Has `isActive`. Never deleted once they've played a
  match — only deactivated; a zero-match player can be hard-deleted (`DELETE /players/:id`,
  409 otherwise).
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
`rating_snapshots` is a cache keyed by `(config_id, match_id, player_id)`; the leaderboard the app
exposes is derived fresh from its latest row per player on every read (see
[docs/DATABASE.md#views-not-tables](DATABASE.md#views-not-tables) — there's a SQL `leaderboard`
view too, but the app doesn't query it directly). This removes an entire class of problems in one
move —
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

Optional refinements on `EloParams`, all off by default and read only from the config being
replayed (never from env vars or globals): `expectationScale`, `goalDifferenceFactor`, `eliteK`,
`repeatOpponentDamping`, `maxDelta`, `ratingFloor`. K is resolved in a fixed order (see
`src/domain/rating/elo.ts`): bracket K → elite override → goal-difference multiplier →
repeat-opponent damping → `delta = K·(S−E)` → clamp to `maxDelta` → apply, then clamp to
`ratingFloor`. With every one off this is bit-identical to plain bracketed Elo. Two deliberately
break zero-sum within a bracket — `eliteK` (when only one side is elite) and `ratingFloor` (when
it catches the loser). `maxDelta` doesn't: it clamps a symmetric ±d pair symmetrically.

- **The elite flag is state, not a function of rating.** Hysteresis (enter at `enterAt`, leave
  below `exitAt`) makes any rating between the two ambiguous, so the flag is carried in
  `RatingState` and persisted in `rating_snapshots.is_elite_after` — the incremental path reads it
  back, or it would diverge from a rebuild.
- **Damping counts meetings of a pair within a session**, so `sessionId` is a replay input
  (`toMatchInputs` in `src/domain/match/result.ts` computes the count for replay, record, and
  preview alike). With the MVP's one long-lived session, that means all-time meetings — decide
  whether that's wanted before adopting damping.

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
