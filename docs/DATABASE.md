# Database

PostgreSQL 16. Drizzle's schema builder (`src/infra/db/schema.ts`) expresses the full schema,
including every `CHECK` constraint and both partial unique indexes (`sessions_one_open`,
`rating_configs_one_active`) — no hand-written SQL needed for those. The one exception is the two
derived views (`match_effective`, `leaderboard`): views with `LATERAL` joins and `FILTER` clauses
are outside what Drizzle's builder can express, so they're hand-written in a custom migration
(`src/infra/db/migrations/0001_views.sql`).

## Tables

- **`users`** — `id`, `name`, `role` (`admin`/`recorder`/`viewer`), `password_hash` (nullable —
  future player-linked/OAuth users won't have one), `created_at`.
- **`players`** — `id`, `name` (unique), `avatar_url`, `is_active`, timestamps. Never hard-deleted.
- **`sessions`** — `id`, `name`, `started_at`, `ended_at` (nullable). Partial unique index
  `sessions_one_open on sessions ((true)) where ended_at is null` enforces **at most one open
  session** at the database level, not just in application code.
- **`matches`** — `id` (uuid, **client-generated**, the idempotency key), `sequence`
  (`generated always as identity`, the only ordering that matters for replay), home/away player,
  home/away score, `decided_on_penalties` (metadata only — never affects rating), `played_at`
  (display-only), optional `session_id`, `recorded_by`. `CHECK` constraints: distinct players,
  non-negative scores, scores ≤ 99.
- **`match_adjustments`** — `id`, `match_id`, its own `sequence` (order among adjustments to the
  same match), `type` (`void`/`correct`), `reason`, and replacement fields that are required for
  `correct` and must be null for `void` (enforced by a single `CHECK` on shape).
- **`rating_configs`** — `id`, `name` (unique), `algorithm`, `params` (jsonb, shape validated by
  Zod in the app layer, not the database), `is_active`. Partial unique index
  `rating_configs_one_active` enforces **exactly one active config**.
- **`rating_snapshots`** — **cache only, safe to truncate and rebuild.** Primary key
  `(config_id, match_id, player_id)`; stores `rating_before`, `rating_after`, `expected_score`,
  `actual_score`, `delta`, `games_played_after`. Indexed on
  `(config_id, player_id, match_sequence desc)` for "latest snapshot per player" lookups.

Full column list and constraint SQL: `src/infra/db/schema.ts` (generated migration:
`src/infra/db/migrations/0000_*.sql`), or the design doc §4 (`../fc-rating-platform-design.md`)
for the original DDL this schema was built from.

## Views (not tables)

- **`match_effective`** — latest effective adjustment per match, overlaid onto the original.
  Actively used: `src/infra/db/queries/match-effective.ts` reads it for every history/profile/
  session-summary read path that needs the current truth of a match without running a full
  replay.
- **`leaderboard`** — latest snapshot per `(config_id, player_id)` joined with win/draw/loss counts
  derived from `match_effective`, per design doc §4.1. **Not currently queried by the application**
  — the `leaderboard()` use-case (`src/app/leaderboard.ts`) independently computes an equivalent
  (plus `form[5]`, streak, `isProvisional`, none of which are practical to express as plain SQL
  aggregates) using `activePlayerRatings()` and the domain layer's pure functions instead. The
  "zero-game players appear at baseline" behavior lives in `activePlayerRatings()`, not in this
  view — a direct SQL consumer of the `leaderboard` view will _not_ see never-played players. The
  view still exists per the design doc and stays correct (see the `is_void` scar in the root
  `CLAUDE.md`) for anyone querying the database directly.

Both are derived views, not materialized — they read live off `matches` /
`match_adjustments` / `rating_snapshots` on every query. At friend-group data volumes this is
fine; if it ever isn't, the fix is a materialized view refreshed after each write transaction, not
a rewrite of the model.

## Replay and rebuild

"Rebuild" (`POST /rating-configs/:id/rebuild`) truncates that config's `rating_snapshots` rows and
replays the entire effective match log from scratch. The integration test suite proves rebuild
produces **byte-identical** snapshots to the incremental path (record → void → correct →
record...) — that equivalence is the strongest correctness guarantee in the system, because it
means the cache can never silently drift from what a from-scratch replay would say.

## Seeds

- One admin user, password from `ADMIN_PASSWORD`.
- One active rating config: `default-elo` —
  `{"baseline":1200,"kProvisional":40,"provisionalGames":10,"kEstablished":24,"drawScore":0.5}`.

## Scripts

`db:generate` (Drizzle migration from schema diff), `db:migrate`, `db:seed`, `db:reset`. See
[DEVELOPMENT.md](DEVELOPMENT.md) for how these fit into local setup.
