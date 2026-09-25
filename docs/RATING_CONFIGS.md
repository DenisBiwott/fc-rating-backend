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

| Column                  | Meaning                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brier**               | Mean of (expected score − actual score)² per match. 0 is perfect; always predicting 0.5 scores 0.25. Lower is better, and rows are ranked by it.                                                                                                                                                                                      |
| **log loss**            | The same predictions scored by cross-entropy, which punishes a confident miss much harder than Brier does. A coin flip scores ln 2 ≈ 0.693.                                                                                                                                                                                           |
| **Brier (established)** | Only matches where both players had finished their provisional games, i.e. the steady state a config is really tuned for. The number in brackets is how many such matches there were. A config with a different `provisionalGames` counts a different set of matches here, so only compare this column between configs that share it. |
| **vs active (± 2 SE)**  | Paired against the active config, match by match: the mean difference in squared error (negative means the candidate predicted better) and two standard errors. Marked `better`/`worse` only outside that margin, `noise` inside it.                                                                                                  |

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
  the error bars, and don't chase differences marked `noise`. How many matches is enough depends
  on how spread out the group's skill is; `pnpm ratings:simulate` (next section) measures it.
- **Trying many candidates on one small history overfits.** The best of twenty candidates on 80
  matches is partly lucky. Prefer the simpler config unless a candidate is clearly better, and
  re-check as matches accumulate.
- **Verdicts on one history aren't independent.** Every candidate is paired against the same
  matches, so a handful of lucky upsets pushes every similar candidate the same way at once. Five
  `noise` leans in one direction are closer to one piece of evidence than to five.

## Can the evaluator tell configs apart yet?

```
pnpm ratings:simulate scripts/rating-config-candidates.json [--baseline <name>] [--players 11] \
  [--matches 100,300,600] [--sigma 100,150,200] [--leagues 400] [--seed 1]
```

A `noise` verdict can mean "these configs predict equally well" or "there isn't enough data to
tell". The real history can't distinguish those, so this simulates many leagues where the answer
is known. Each player gets a true skill, matches are played from it, and every candidate is
replayed through the real engine and judged by the evaluator's own ±2 SE rule. No database is
involved. The baseline defaults to the first candidate in the file.

**Match the simulation to your data first.** `--sigma` is the standard deviation of true skill,
in Elo points. Your group's isn't known directly, so it's inferred from two numbers: the active
config's **Brier** from `ratings:evaluate`, and the leaderboard's **spread** (top rating minus
bottom). Each block prints where the middle 80% of simulated leagues landed on both. Run a wide σ
range at your real `--players` and `--matches`: the plausible σ values are the ones whose ranges
contain both of your numbers. Use the ranges, not a single average. The real league is one draw,
and at a hundred-odd matches Brier on its own barely narrows σ down. Then read the tables across
that whole σ range, adding larger `--matches` values to see when a difference would become
detectable.

| Column                              | Meaning                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Brier**                           | The mean Brier across the simulated leagues: what `ratings:evaluate` would print on such a league, on average.                         |
| **verdict: better / noise / worse** | How often the evaluator's verdict against the baseline came out each way. Mostly `noise` means the evaluator is blind at this size.    |
| **wrong calls**                     | How often a `better`/`worse` verdict pointed the opposite way from the truth. This is what tells you whether a verdict can be trusted. |
| **truly better**                    | How often the candidate's predictions really were closer to the true probabilities than the baseline's. Near 50% means no real gap.    |
| **rank ρ**                          | Spearman correlation between final ratings and true skills: how right the leaderboard's order is (1 = perfect).                        |

What the model assumes, and so what it can't tell you:

- **Skills are fixed.** Real players improve, which favours a higher K than the simulation will.
- **Goals are Poisson**, with each side's scoring rate tilted by the skill gap. That makes goal
  difference genuinely informative, so it flatters `goalDifferenceFactor`. Real blowouts partly
  reflect someone giving up.
- **Everyone is there from the start**, and opponents are drawn at random, weighted by how active
  each player is. There's no home advantage.

### What it showed at 117 matches (2026-09-25)

**Where our group sits.** Production had a Brier of 0.1952 under the active config and a
leaderboard spread of 366 points. Matching the Brier's simulated _average_ first suggested
σ ≈ 100, which was wrong: at σ 100 a single league's Brier ranges 0.175–0.213, so it barely
narrows σ down, while only 2% of σ 100 leagues reach a 366-point spread. Taking both numbers
together, σ ≈ 150–250 is plausible, most likely around 200.

**What that means at our size** (σ 150–200, 117 matches):

- **The all-`noise` result was expected.** The evaluator catches a real difference only about
  20–58% of the time here. Wrong calls stayed at 0–1% in every block.
- **Bigger steps help now, but not for long.** Higher K and steeper goal difference are truly
  better in about 80–98% of simulated leagues, and that edge fades as the league matures (by 1000
  matches at σ 150, lower K is the better one). Early on, ratings are far from the truth and big
  steps close the gap; later they're close and big steps mostly add noise. A single league-wide K
  can't be right at both ends.
- **Part of what goal difference seems to add is just a bigger K.** Its multiplier averages
  about 1.3, so turning it on also raises how far ratings move.
- **Tuning doesn't fix the leaderboard's order; matches do.** Every candidate ranked players
  about equally well (rank ρ ≈ 0.82–0.86 at 117 matches). More matches is what raises it.

**The candidate this led to: `elo-tuned-v2`.** It's `elo-tuned-v1` with K 40 for a player's first
20 games, then 16. The step size follows each player's maturity instead of the league's: a
rating is unreliable while its player has few games, however old the league is, and a friend who
joins at match 500 gets the same treatment. That is Glicko's idea approximated with an existing
parameter. Three shapes were tried, in simulation only, so the real history played no part in
choosing: 20 games then 20, 20 then 16, and 30 then 20. This was the only one truly better than
`elo-tuned-v1` at every stage at both σ 150 and σ 200 (69–94% and 87–98% of leagues, from 117 to
1000 matches), at a small early cost at σ 100 (28% at 117 matches, even by 600). Its elite K
stays 14, as tested, which is now barely below the established 16; revisit `eliteK` separately.

Adopting it changes more than the numbers. `provisionalGames` 20 puts `PROV x/20` back on anyone
with 10–19 games (the frontend reads it from `/leaderboard`), and the rebuild rewrites every
rating, so the order will shift. After creating it (inactive), see the result first with
**Rating configs → Preview the leaderboard a rating config would produce**.

**Decision rule, fixed before running it against production.** At 117 matches the evaluator
catches `elo-tuned-v2`'s edge only 13–30% of the time, so waiting for `better` would mean waiting
months. The case for it is the simulation plus the reasoning above, and the real history can
only veto it. Run `ratings:evaluate` on production and read only `elo-tuned-v2`'s
`vs active` row:

- **Negative difference** (`better`, or `noise` leaning better): consistent with the simulation.
  Preview the leaderboard, then adopt if the reshuffle is acceptable.
- **Positive difference**: the real history disagrees with the simulation's assumptions (players
  improving, or goal difference behaving differently in real games). Don't adopt; re-check at
  about 300 matches.

**Result (2026-09-25, 125 matches): not adopted.** `elo-tuned-v2` came out at +0.0048 ± 0.0053
against the active config, leaning worse, while `elo-tuned-v1-k-higher` again leaned better
(−0.0015). The real history disagrees with the simulation, and the likeliest assumption at fault is
fixed skills: v2 drops experienced players to K 16, which would be too slow if people are still
improving, and a simulation without improvement can't see that. Don't answer this by tuning new
variants against these same matches; test the assumption instead (add skill drift to the
simulation and see whether v2's edge survives), then re-check at about 300 matches.

Next check either way: both tools at about 300 and 600 matches.

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
