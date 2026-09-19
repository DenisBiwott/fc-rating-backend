# API

Base path `/api/v1`, JSON, cookie auth. All request/response bodies are Zod schemas; the same
schemas generate `openapi.json` at the repo root (OpenAPI 3.1) — that file is the contract the
frontend repo consumes. Errors are RFC 9457 Problem Details
(`application/problem+json`), including Zod validation detail. Lists are cursor-paginated
(`?cursor=&limit=`, cursor = `sequence`).

The full route table (methods, roles, request/response shapes) lives in design doc §6
(`../fc-rating-platform-design.md`) and, once generated, in `openapi.json` itself — treat the
generated file as more current than this doc for exact shapes. This page covers what doesn't
show up in a route list.

## Auth

Single shared admin password (`ADMIN_PASSWORD` env var) → signed HTTP-only cookie, 30-day
lifetime. `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Auth is deliberately outside
the record-match flow — a device logs in once and stays logged in.

Roles (`admin` > `recorder` > `viewer`) are enforced by a small Fastify `preHandler`, not
middleware chains or a permissions library. At MVP the one admin user holds all three
capabilities; the role split exists so recorder/viewer accounts are a data change later, not a
code change.

The session cookie is `SameSite=None; Secure` — required because the frontend (Netlify) and this
API (Cloud Run) are on different sites, not just different ports like local dev. `Secure` cookies
work on `http://localhost` too, so no dev/prod split is needed.

## Idempotency

`POST /matches` takes a client-generated UUID v7 as `id`. If that `id` has already been recorded,
the endpoint returns **200 with the original result**, not a 409 or 422 — a retried request after
a dropped response must be indistinguishable from a successful first attempt. This is what makes
"tap Confirm again after a flaky connection" safe on a phone.

On a retried `id`, `rankChanges` comes back empty rather than reconstructed — the schema doesn't
persist historical leaderboard position, so a retry can't know what the ranks _were_ at record
time versus now. `match` and `outcome` (ratings, deltas, `upset`) are exact either way; only the
"your rank changed" fanfare is skipped on a retry.

## The response shape the UI cares about most

```ts
POST /matches →
{
  match: MatchDto,
  outcome: {
    home: { playerId, before, after, delta, expectedScore, wasProvisional },
    away: { ... },
    upset: boolean   // true when the pre-match underdog (expectedScore < 0.5) won
  },
  rankChanges: [{ playerId, from: number, to: number }]
}
```

`POST /matches/preview` returns the same `outcome` shape without writing anything — it's what
powers the record-match preview line, called on every score change (debounced 150ms on the
frontend). Pass the same optional `sessionId` the match will be recorded with: under a config with
repeat-opponent damping, the preview can't match the recorded result without it.

## Void and correct

Both are admin-only, both require a `reason`, and both trigger a full replay of the active config
under the advisory lock (see [ARCHITECTURE.md](ARCHITECTURE.md#concurrency-model)). Neither
endpoint deletes a row — `match_adjustments` is append-only, and the _effective_ match is always
"original overlaid with the latest adjustment."

## Ops

`GET /health` checks the database connection, not just process liveness — returns
`{status, db: 'ok'}`.
