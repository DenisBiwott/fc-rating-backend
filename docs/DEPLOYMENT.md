# Deployment

Google Cloud Run (free-tier scale-to-zero) + Neon Postgres (managed, serverless). No VPS, no
Docker Compose in production, no Caddy — Cloud Run terminates TLS and handles routing itself.
Anything more elaborate (orchestration, multi-region) is out of scope on purpose — see design doc
§14, "risks and traps": the point of this project is to learn the domain and the data model, not
to practice DevOps for its own sake. (This supersedes an earlier single-VPS-plus-Caddy plan that
predated the Cloud Run/Neon decision.)

## Migrations

Run on container start (`docker-entrypoint.sh` → `scripts/migrate.ts`, via
`drizzle-orm/postgres-js/migrator`), gated by `pg_advisory_lock(hashtext('fc_rating_migrations'))`
on the migration script's own connection so two Cloud Run instances starting concurrently (traffic
burst, rolling deploy) never race applying the same migration — the second simply blocks until the
first finishes and releases the lock.

## Backups

Neon has its own point-in-time-recovery; evaluate whether that alone is
sufficient before building anything extra.
TODO — not yet decided.

## CI/CD

Deploy is Cloud Run's own **continuous deployment from a repository**: the service is configured
to watch this repo directly and build/deploy from the root `Dockerfile` (`/Dockerfile`) on every
push to the connected branch, via Cloud Build behind the scenes — no `gcloud run deploy`, no
manual image push, no GitHub Actions deploy step needed for the backend. This is why the
`Dockerfile` lives at the repo root rather than under `docker/` or similar — that path is exactly
what the Cloud Run trigger points at.

A `.github/` workflow is still worth adding, but scoped to what Cloud Run's trigger _doesn't_
cover: lint/typecheck/test/`generate:openapi:check` as a PR gate, so a broken build only reaches
Cloud Run's own build step (and a live deploy) after those pass locally-equivalent checks — not
build/push/deploy itself. Not yet built.

## Dockerfile

Multi-stage build (`deps` → `build` → `prod-deps` → `runtime`), `node:22-alpine` runtime (no
native deps in this app, so alpine is safe and keeps the image small). `pnpm install` runs with
`--ignore-scripts` in both install stages — sidesteps pnpm's build-script approval gate (its
approved-builds state is host-machine-local, not something a clean Cloud Build checkout has), and
nothing this image actually needs (`tsc`, not `tsx`/esbuild) requires those install scripts anyway.
Runs as the image's built-in non-root `node` user. `docker-entrypoint.sh` runs migrations then
`exec`s into `node dist/src/server.js` so it becomes PID 1 and receives Cloud Run's SIGTERM
directly for a graceful shutdown (`src/server.ts`'s SIGTERM/SIGINT handler calls `app.close()`).

Verified locally, 2026-09-14: `docker build` succeeds (~188MB image); `docker run` against the real
Neon DB applied migrations to a previously-empty database, started the server, and
`GET /health` returned `{"status":"ok","db":"ok"}`; a second run's migrations no-op'd cleanly
(advisory lock didn't deadlock); `docker stop` produced a logged `SIGTERM` and a clean exit 0.

Cloud Run injects `PORT` automatically (reserved — never set by hand in the service config) to
match whatever "Container port" the service is configured with; this image's default is `8080`
(`EXPOSE 8080`). `DATABASE_URL`, `ADMIN_PASSWORD`, `COOKIE_SECRET`, and `CORS_ORIGIN` still need to
be configured on the Cloud Run service itself (ideally the first three via Secret Manager) — not
yet done, tracked as a follow-up task.
