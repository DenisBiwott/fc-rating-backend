# Postman

`postman/` holds a Postman collection covering every route in `openapi.json`, plus two
environments. All three files are **generated** by `scripts/generate-postman.ts`. Never edit them
by hand: change the generator and regenerate.

| File                                          | What it is                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `postman/fc-rating.postman_collection.json`   | Every route, one folder per area (Health, Auth, Players, Matches, …)           |
| `postman/local.postman_environment.json`      | `baseUrl` `http://localhost:3000`, `adminPassword` `.env.example`'s `changeme` |
| `postman/production.postman_environment.json` | `baseUrl` the Cloud Run URL, `adminPassword` blank on purpose                  |

## Setup

1. In Postman, **Import** all three files from `fc-rating-backend/postman/`.
2. Pick an environment in the top-right selector.
3. For **Production**, set `adminPassword` as the environment's **Current value** only. Postman
   syncs _Initial_ values to its servers but keeps _Current_ values on your machine, so the real
   password never leaves it.

Re-importing after a regenerate replaces the collection; your environments' current values stay.

## Using it

- **Log in first**: run **Auth → Log in with the shared admin password**. Postman keeps the session
  cookie, so every request after it is logged in (checked with Newman, Postman's CLI runner, over
  plain `http://localhost`). **Auth → Clear the session cookie** (log out) is last in its folder, so running
  the whole folder doesn't log you out halfway.
- **IDs fill themselves in.** Creating a player, recording a match, opening a session, or creating a
  rating config captures the new id into a collection variable (`playerId`, `matchId`, `sessionId`,
  `configId`). Every request with an `:id` in its path uses the matching one. To target a different
  record, edit the variable (the collection's **Variables** tab).
- **Match requests** use `homePlayerId`/`awayPlayerId`: set them by hand from
  **Players → List players**.
- **Recording a match**: its `id` is `{{$guid}}`, a fresh UUID on every send, so every send records
  a new match. The `id` is the idempotency key; to retry one submission safely, use a fixed UUID.
- **Destructive requests** (delete, void, correct, create/rebuild config) do exactly what they say
  against whichever environment is selected. Check the selector before sending against Production.

## Keeping it current

The collection is generated from the committed `openapi.json`, so it can't list a route the
contract doesn't have. Generation _fails_ when:

- a route takes a request body but has no example in the generator (`BODIES`);
- an example no longer matches the route's Zod schema;
- a route has a new tag or `:id` resource the generator doesn't know (`FOLDERS`, `ID_VARIABLES`).

`pnpm generate:openapi` regenerates the collection too. `pnpm generate:postman:check` fails if the
committed files are stale. Commit `postman/` in the same change as the route change — see the
process rule in the root `CLAUDE.md`.
