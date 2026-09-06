# Deployment

Single VPS, Docker Compose: `postgres:16` (named volume), `api`, `caddy` (auto-TLS). Anything
more elaborate (orchestration, multi-region, managed DB) is out of scope on purpose — see design
doc §14, "risks and traps": the point of this project is to learn the domain and the data model,
not to practice DevOps for its own sake.

## Migrations

Run on container start via `drizzle-kit migrate`, gated by an advisory lock so two replicas never
race applying the same migration. There is exactly one replica in this deployment; the lock is a
habit worth having anyway because it's free.

## Backups

Nightly `pg_dump | gzip` to object storage via a cron container. Test a restore at least once
before trusting the backup — an untested backup is a hypothesis, not a backup.

## CI/CD

GitHub Actions: on PR — lint, typecheck, test, build image. On `main` — build + push image + SSH
deploy (`docker compose pull && docker compose up -d`).

## Dockerfile

Multi-stage build, `node:22-slim` (or distroless) runtime, runs migrations then starts the server.
