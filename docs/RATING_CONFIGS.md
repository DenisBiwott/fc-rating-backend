# Rating configs: tuning and adopting

A rating config is a named set of Elo parameters. Every rating in the app is derived by replaying
the effective match log through the **active** config (see
[ARCHITECTURE.md](ARCHITECTURE.md#rating-engine-domainrating) for the engine and its optional
features). Changing how ratings behave never means editing a stored config's parameters: you
create a new config, check how it would have done, then activate it and rebuild.

## Evaluate candidates

```
pnpm ratings:evaluate [candidates.json]
```

This replays the full effective match log, in memory, through every stored config plus each
candidate in the file, and scores how well each one's expectations predicted the actual results.
It persists nothing, and its reads run in a `READ ONLY` transaction, so Postgres itself would
reject a write. That makes it safe to run against production.

- **Candidates file**: a JSON array of `POST /rating-configs` bodies (`name`, `algorithm`,
  `params`), validated by the same schema that route uses. So a candidate is scored with exactly
  the defaults it would be stored with, and any entry can be POSTed as it is.
  `scripts/rating-config-candidates.json` holds the current set; edit it freely.
- **Against production**: pass the Neon connection string inline, following the pattern in
  [DEPLOYMENT.md](DEPLOYMENT.md#first-time-production-setup). Never edit `.env`'s active
  `DATABASE_URL` for this:
  ```
  DATABASE_URL="<neon DATABASE_URL>" pnpm ratings:evaluate scripts/rating-config-candidates.json
  ```
  The first line of output names the database it read. Check it before trusting the numbers.

### Reading the output

| Column                  | Meaning                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Brier**               | Mean of (expected score − actual score)² per match. 0 is perfect; always predicting 0.5 scores 0.25. Lower is better, and rows are ranked by it.                                                                                     |
| **log loss**            | The same predictions scored by cross-entropy, which punishes a confident miss much harder than Brier does. A coin flip scores ln 2 ≈ 0.693.                                                                                          |
| **Brier (established)** | Only matches where both players had finished their provisional games, i.e. the steady state a config is really tuned for. The number in brackets is how many such matches there were.                                                |
| **vs active (± 2 SE)**  | Paired against the active config, match by match: the mean difference in squared error (negative means the candidate predicted better) and two standard errors. Marked `better`/`worse` only outside that margin, `noise` inside it. |

Pairing matters. Comparing two Brier scores side by side mixes in how hard each match was to
call. The paired difference cancels that out, so it can tell configs apart with far fewer matches.

A candidate showing `0.0000 ± 0.0000` against the active config behaved identically on this
history: the features it adds never engaged. For example, nobody reached the elite threshold, or
the floor and `maxDelta` never bit.

### What it can't tell you

- **Only predictive accuracy.** `ratingFloor`, `maxDelta`, `eliteK` and repeat-opponent damping
  exist partly for fairness and stability. A config can score slightly worse and still be the
  right choice.
- **Small samples are mostly noise.** With a few dozen matches almost every difference is inside
  the error bars. Re-evaluate after 100 or more real matches, and don't chase differences marked
  `noise`.
- **Trying many candidates on one small history overfits.** The best of twenty candidates on 80
  matches is partly lucky. Prefer the simpler config unless a candidate is clearly better, and
  re-check as matches accumulate.

## Adopt a config

Done with the Postman collection ([POSTMAN.md](POSTMAN.md)) plus one SQL step, since there's no
activate endpoint. The steps are identical locally and in production; only the Postman environment
and the SQL tool differ. Nothing needs a restart: every request reads the active config fresh.

**Before you start:** select the right environment in Postman's top-right selector (**FC Rating —
Production** or **FC Rating — Local**) and, for Production, make sure `adminPassword` has its
Current value set. Don't record any matches (in Postman or the web app) until step 4 is done.

1. **Log in.** Send **Auth → Log in with the shared admin password**. Expect `200` and the test
   result _logged in_ passing. A `429` means five attempts in 15 minutes: wait and retry.
2. **Create the config.** Open **Rating configs → Create a rating config**. The body is already
   the recommended `elo-tuned-v1`; to adopt a different candidate, paste its entry from
   `scripts/rating-config-candidates.json` in place of the body. Send. Expect `201` with:
   - `"isActive": false`;
   - every feature echoed back in `params` (`goalDifferenceFactor`, `eliteK`,
     `repeatOpponentDamping`, `maxDelta`, `ratingFloor`). If they're missing, the server is running
     code older than the Elo refinements and has stored a plain config. Stop there and deploy
     first.

   The new `id` is captured into the `configId` collection variable automatically. A `409` means a
   config with that name already exists: check **Rating configs → List rating configs**.

3. **Activate it in SQL.** In production, use the Neon console's **SQL Editor** on the app's
   database; locally, run `docker compose -f docker-compose.dev.yml exec postgres psql -U fc_rating
fc_rating`. Run:
   ```sql
   begin;
   update rating_configs set is_active = false where is_active;
   update rating_configs set is_active = true where name = 'elo-tuned-v1';
   commit;
   ```
   Expect `UPDATE 1` twice. It must be two statements, because the partial unique index
   `rating_configs_one_active` allows only one active row at any moment. If the editor runs them
   separately rather than as one transaction it still works, but for a moment there's no active
   config and any request in that moment fails.
4. **Rebuild it, immediately.** Send **Rating configs → Rebuild rating snapshots for a config by
   replaying matches**; it uses `{{configId}}` from step 2. Expect `200` with that same
   `configId` and a `matchCount` equal to the number of non-void matches (`0` in a fresh
   production database). Why immediately: a config has no stored ratings until it's rebuilt, and
   recording a match reads the active config's latest ones, so a match recorded between steps 3
   and 4 would treat both players as brand new. The rebuild replays everything, so it also
   corrects any match that slipped in.
5. **Verify.** **Rating configs → List rating configs** shows the new config with
   `"isActive": true` and the old one `false`. **Leaderboard → Get the current leaderboard** shows
   the ratings under it. The web app picks it up on its next load.

**First real match after adopting:** the record screen's preview should match the new config.
Between two brand-new players under `elo-tuned-v1`, a 1-0 or 2-1 win shows ±19.70 (32 × 1.231 ×
0.5) and a 2-0 win ±21.86. Under `default-elo` both would have been ±20.

**Rolling back:** the same procedure pointed at the previous config. Skip step 2, put the previous
config's `id` (from **List rating configs**) in the `configId` collection variable, use its name in
step 3's SQL, then rebuild. Its stored ratings stopped updating when it was deactivated, and the
rebuild brings them up to date.

## Why `elo-tuned-v1` has the values it has

The first entry in `scripts/rating-config-candidates.json` is a reasoned starting point, not a
fitted one: when it was written there were no real matches to fit to.

- **K 32 provisional / 20 established** (down from 40/24): the goal-difference multiplier raises
  K on every decisive result, by roughly 1.3 on average, so K is lowered to keep typical swings
  about where they were.
- **`goalDifferenceFactor` divisor 3, cap 1.5**: with divisor 2, every win by two goals or more
  is already at the cap. Divisor 3 steps up 1.23 → 1.37 → 1.46 for one-, two- and three-goal wins
  and caps from four goals, which suits FC's high-scoring games, where blowouts partly reflect
  someone giving up.
- **`eliteK` enter 1350 / exit 1320, k 14**: 1500 is 300 points above the baseline and may never
  be reached in a small group. The 30-point band is wider than the largest possible elite loss
  (14 × 1.5 = 21), so a player who has just entered elite can't be knocked straight back out by
  one bad result.
- **`maxDelta` 35**: only limits the extreme case, a provisional player's upset blowout (up to
  32 × 1.5 = 48).
- **`ratingFloor` 900**: a rating settles where a player's expected score against an average
  (1200) player matches their real win rate. A floor at 1000 would hold anyone expected to win
  under 24% of games, which is plausible for a genuinely weaker player, so it would clamp them
  routinely. At 900 the cutoff is 15%, which keeps it a rare safety net.
- **`repeatOpponentDamping` off**: it counts meetings per session, and production runs one
  long-lived session, so it would damp frequent pairs permanently. It becomes worth enabling if
  sessions start and stop per play night. The frontend's preview also doesn't send `sessionId`
  yet, so with damping on, the preview would show larger deltas than what gets recorded.
- **`expectationScale` 400**: it mostly sets the units ratings are measured in rather than how
  good predictions are, so it stays at the Elo convention.
