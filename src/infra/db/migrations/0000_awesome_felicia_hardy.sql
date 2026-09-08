CREATE TYPE "public"."adjustment_type" AS ENUM('void', 'correct');--> statement-breakpoint
CREATE TYPE "public"."rating_algorithm" AS ENUM('elo');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'recorder', 'viewer');--> statement-breakpoint
CREATE TABLE "match_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"match_id" uuid NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "match_adjustments_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "adjustment_type" NOT NULL,
	"reason" text NOT NULL,
	"new_home_player_id" uuid,
	"new_away_player_id" uuid,
	"new_home_score" smallint,
	"new_away_score" smallint,
	"adjusted_by" uuid NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_adjustments_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "adj_shape" CHECK ((
        "match_adjustments"."type" = 'void' and "match_adjustments"."new_home_score" is null and "match_adjustments"."new_away_score" is null
                              and "match_adjustments"."new_home_player_id" is null and "match_adjustments"."new_away_player_id" is null
      ) or (
        "match_adjustments"."type" = 'correct' and "match_adjustments"."new_home_score" is not null and "match_adjustments"."new_away_score" is not null
                              and "match_adjustments"."new_home_player_id" is not null and "match_adjustments"."new_away_player_id" is not null
                              and "match_adjustments"."new_home_player_id" <> "match_adjustments"."new_away_player_id"
                              and "match_adjustments"."new_home_score" >= 0 and "match_adjustments"."new_away_score" >= 0
      ))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "matches_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"home_player_id" uuid NOT NULL,
	"away_player_id" uuid NOT NULL,
	"home_score" smallint NOT NULL,
	"away_score" smallint NOT NULL,
	"decided_on_penalties" boolean DEFAULT false NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_sequence_unique" UNIQUE("sequence"),
	CONSTRAINT "matches_distinct_players" CHECK ("matches"."home_player_id" <> "matches"."away_player_id"),
	CONSTRAINT "matches_scores_nonneg" CHECK ("matches"."home_score" >= 0 and "matches"."away_score" >= 0),
	CONSTRAINT "matches_scores_sane" CHECK ("matches"."home_score" <= 99 and "matches"."away_score" <= 99)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rating_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"algorithm" "rating_algorithm" NOT NULL,
	"params" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rating_configs_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "rating_snapshots" (
	"config_id" uuid NOT NULL,
	"match_id" uuid NOT NULL,
	"match_sequence" bigint NOT NULL,
	"player_id" uuid NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"expected_score" double precision NOT NULL,
	"actual_score" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"games_played_after" integer NOT NULL,
	CONSTRAINT "rating_snapshots_config_id_match_id_player_id_pk" PRIMARY KEY("config_id","match_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_adjustments" ADD CONSTRAINT "match_adjustments_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_adjustments" ADD CONSTRAINT "match_adjustments_new_home_player_id_players_id_fk" FOREIGN KEY ("new_home_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_adjustments" ADD CONSTRAINT "match_adjustments_new_away_player_id_players_id_fk" FOREIGN KEY ("new_away_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_adjustments" ADD CONSTRAINT "match_adjustments_adjusted_by_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_player_id_players_id_fk" FOREIGN KEY ("home_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_player_id_players_id_fk" FOREIGN KEY ("away_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_snapshots" ADD CONSTRAINT "rating_snapshots_config_id_rating_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."rating_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_snapshots" ADD CONSTRAINT "rating_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_snapshots" ADD CONSTRAINT "rating_snapshots_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adj_match_idx" ON "match_adjustments" USING btree ("match_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_home_idx" ON "matches" USING btree ("home_player_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_away_idx" ON "matches" USING btree ("away_player_id","sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_session_idx" ON "matches" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_configs_one_active" ON "rating_configs" USING btree ((true)) WHERE "rating_configs"."is_active";--> statement-breakpoint
CREATE INDEX "snapshots_player_idx" ON "rating_snapshots" USING btree ("config_id","player_id","match_sequence" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open" ON "sessions" USING btree ((true)) WHERE "sessions"."ended_at" is null;