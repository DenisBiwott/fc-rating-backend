# Configuration

`src/config.ts`'s `loadConfig()` parses and validates every env var with Zod at process startup —
a missing or malformed var fails fast, not at first use. `scripts/seed.ts`, `scripts/migrate.ts`,
and `scripts/reset-db.ts` still read `process.env.DATABASE_URL` (and `seed.ts` also
`ADMIN_PASSWORD`) directly with a manual `if (x === undefined) throw` guard, not through
`config.ts` — they run before/outside the HTTP server. Integration and API tests don't read
`ADMIN_PASSWORD`/`COOKIE_SECRET`/`PORT`/`NODE_ENV` from the environment at all: they default
`DATABASE_URL` in code if it's unset (`test/integration/helpers/test-db.ts`) and build a fixed
`Config` object directly (`test/api/helpers/app.ts`).

| Var              | Required                   | Notes                                                                                                       |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`   | yes                         | Postgres connection string. `docker-compose.dev.yml` exposes Postgres on `5432` locally.                     |
| `ADMIN_PASSWORD` | yes (seed only)             | Plaintext in env, hashed before storage. The single shared admin login — see [API.md](API.md#auth).          |
| `COOKIE_SECRET`  | yes                         | Signs the `@fastify/cookie` session cookie. Min 32 characters — `src/config.ts` rejects a shorter one. Rotate = all sessions invalidated. |
| `PORT`           | no — defaults to `3000`     | HTTP listen port, parsed in `src/config.ts`.                                                                 |
| `NODE_ENV`       | no — defaults to `development` | Gates pino pretty-printing in `src/http/build-app.ts`; `test` silences Fastify's own request logger entirely. |

`.env.example` at the repo root mirrors this table; keep the two in sync. This table explains
_why_ a var exists, `.env.example` is what you copy.
