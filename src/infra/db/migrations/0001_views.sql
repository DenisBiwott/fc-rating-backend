-- Derived views, not tables — see fc-rating-backend/docs/DATABASE.md#views.
-- Not expressible via Drizzle's schema builder (LATERAL join, FILTER, UNION); hand-written here
-- and kept out of src/infra/db/schema.ts so `drizzle-kit generate` never tries to diff them away.

-- latest effective adjustment per match
create view match_effective as
select m.id, m.sequence,
       coalesce(a.new_home_player_id, m.home_player_id) as home_player_id,
       coalesce(a.new_away_player_id, m.away_player_id) as away_player_id,
       coalesce(a.new_home_score, m.home_score)         as home_score,
       coalesce(a.new_away_score, m.away_score)         as away_score,
       -- coalesce is required: when there's no adjustment, a.type is null, and `null = 'void'`
       -- evaluates to null (not false) — a bare `WHERE not is_void` would then silently exclude
       -- every never-adjusted match, which is most of them.
       coalesce(a.type = 'void', false)                   as is_void,
       m.played_at, m.session_id, m.recorded_by, m.recorded_at, m.decided_on_penalties
from matches m
left join lateral (
  select * from match_adjustments x where x.match_id = m.id order by x.sequence desc limit 1
) a on true;

-- leaderboard for a config: latest snapshot per player + W/L/D from effective matches
create view leaderboard as
with latest as (
  select distinct on (config_id, player_id) config_id, player_id, rating_after as rating, games_played_after as games
  from rating_snapshots order by config_id, player_id, match_sequence desc
),
results as (
  select p.id as player_id,
         count(*) filter (where (e.home_player_id = p.id and e.home_score > e.away_score)
                             or (e.away_player_id = p.id and e.away_score > e.home_score)) as wins,
         count(*) filter (where e.home_score = e.away_score) as draws,
         count(*) filter (where (e.home_player_id = p.id and e.home_score < e.away_score)
                             or (e.away_player_id = p.id and e.away_score < e.home_score)) as losses
  from players p
  join match_effective e on (e.home_player_id = p.id or e.away_player_id = p.id) and not e.is_void
  group by p.id
)
select l.config_id, l.player_id, l.rating, l.games,
       coalesce(r.wins,0) wins, coalesce(r.draws,0) draws, coalesce(r.losses,0) losses
from latest l left join results r using (player_id);
