# Configuration

**Today:** there's no `src/config.ts` yet (that's part of the HTTP layer, step 5 — see
[DEVELOPMENT.md](DEVELOPMENT.md#build-order)). `scripts/seed.ts`, `scripts/migrate.ts`, and
`scripts/reset-db.ts` each read `process.env.DATABASE_URL` (and `seed.ts` also
`ADMIN_PASSWORD`) directly, with a manual `if (x === undefined) throw` guard — not Zod. Integration
tests don't read `ADMIN_PASSWORD`/`COOKIE_SECRET`/`PORT`/`NODE_ENV` at all; they default
`DATABASE_URL` in code if the env var is unset (see `test/integration/helpers/test-db.ts`).

**Planned (step 5):** all env vars parsed and validated by Zod in `src/config.ts` at startup — a
missing or malformed var fails fast, not at first use.

| Var              | Required today  | Notes                                                                                                                       |
| ---------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | yes (scripts)   | Postgres connection string. `docker-compose.dev.yml` exposes Postgres on `5432` locally.                                    |
| `ADMIN_PASSWORD` | yes (seed only) | Plaintext in env, hashed before storage. The single shared admin login — see [API.md](API.md#auth) (HTTP layer, not built). |
| `COOKIE_SECRET`  | not yet used    | Will sign the auth cookie once HTTP auth exists. Rotate = all sessions invalidated.                                         |
| `PORT`           | not yet used    | Will default per `config.ts` once it exists.                                                                                |
| `NODE_ENV`       | not yet used    | Will gate things like pino pretty-printing once HTTP exists.                                                                |

`.env.example` at the repo root mirrors this table; keep the two in sync. This table explains
_why_ a var exists, `.env.example` is what you copy.
