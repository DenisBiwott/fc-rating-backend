# Configuration

All env vars are parsed and validated by Zod in `src/config.ts` at startup — a missing or
malformed var fails fast, not at first use.

| Var              | Required | Notes                                                                                                          |
| ---------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | yes      | Postgres connection string. `docker-compose.dev.yml` exposes Postgres on `5432` locally.                       |
| `ADMIN_PASSWORD` | yes      | Plaintext in env, hashed before storage/comparison. The single shared admin login — see [API.md](API.md#auth). |
| `COOKIE_SECRET`  | yes      | Signs the auth cookie. Rotate = all sessions invalidated.                                                      |
| `PORT`           | no       | Defaults per `config.ts`.                                                                                      |
| `NODE_ENV`       | yes      | `development` / `test` / `production`. Gates things like pino pretty-printing.                                 |

`.env.example` at the repo root mirrors this table once the repo is scaffolded — keep the two in
sync; this table explains _why_ a var exists, `.env.example` is what you copy.
