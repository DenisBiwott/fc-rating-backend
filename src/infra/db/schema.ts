import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Tables, enums, constraints, and indexes — Drizzle's builder expresses all of it here, including
 * the CHECK constraints and the two partial unique indexes (sessions_one_open,
 * rating_configs_one_active). The two derived views (match_effective, leaderboard) are the one
 * thing Drizzle can't express (LATERAL join, FILTER, UNION) — hand-written in
 * src/infra/db/migrations/0001_views.sql. See fc-rating-backend/docs/DATABASE.md for the
 * authoritative schema description.
 */

export const userRole = pgEnum('user_role', ['admin', 'recorder', 'viewer'])
export const adjustmentType = pgEnum('adjustment_type', ['void', 'correct'])
export const ratingAlgorithm = pgEnum('rating_algorithm', ['elo'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  role: userRole('role').notNull(),
  passwordHash: text('password_hash'), // null for future player-linked/OAuth users
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const players = pgTable('players', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    // At most one open session. Drizzle can express the partial predicate; verified against the
    // generated SQL in the migration.
    uniqueIndex('sessions_one_open')
      .on(sql`(true)`)
      .where(sql`${table.endedAt} is null`),
  ],
)

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey(), // client-generated (idempotency key)
    sequence: bigint('sequence', { mode: 'number' }).notNull().generatedAlwaysAsIdentity().unique(),
    homePlayerId: uuid('home_player_id')
      .notNull()
      .references(() => players.id),
    awayPlayerId: uuid('away_player_id')
      .notNull()
      .references(() => players.id),
    homeScore: smallint('home_score').notNull(),
    awayScore: smallint('away_score').notNull(),
    decidedOnPenalties: boolean('decided_on_penalties').notNull().default(false),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull().defaultNow(),
    sessionId: uuid('session_id').references(() => sessions.id),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('matches_home_idx').on(table.homePlayerId, table.sequence.desc()),
    index('matches_away_idx').on(table.awayPlayerId, table.sequence.desc()),
    index('matches_session_idx').on(table.sessionId, table.sequence),
    check('matches_distinct_players', sql`${table.homePlayerId} <> ${table.awayPlayerId}`),
    check('matches_scores_nonneg', sql`${table.homeScore} >= 0 and ${table.awayScore} >= 0`),
    check('matches_scores_sane', sql`${table.homeScore} <= 99 and ${table.awayScore} <= 99`),
  ],
)

export const matchAdjustments = pgTable(
  'match_adjustments',
  {
    id: uuid('id').primaryKey(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    sequence: bigint('sequence', { mode: 'number' }).notNull().generatedAlwaysAsIdentity().unique(),
    type: adjustmentType('type').notNull(),
    reason: text('reason').notNull(),
    // Required together for type = 'correct', forbidden for type = 'void' — see adj_shape below.
    newHomePlayerId: uuid('new_home_player_id').references(() => players.id),
    newAwayPlayerId: uuid('new_away_player_id').references(() => players.id),
    newHomeScore: smallint('new_home_score'),
    newAwayScore: smallint('new_away_score'),
    adjustedBy: uuid('adjusted_by')
      .notNull()
      .references(() => users.id),
    adjustedAt: timestamp('adjusted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('adj_match_idx').on(table.matchId, table.sequence.desc()),
    check(
      'adj_shape',
      sql`(
        ${table.type} = 'void' and ${table.newHomeScore} is null and ${table.newAwayScore} is null
                              and ${table.newHomePlayerId} is null and ${table.newAwayPlayerId} is null
      ) or (
        ${table.type} = 'correct' and ${table.newHomeScore} is not null and ${table.newAwayScore} is not null
                              and ${table.newHomePlayerId} is not null and ${table.newAwayPlayerId} is not null
                              and ${table.newHomePlayerId} <> ${table.newAwayPlayerId}
                              and ${table.newHomeScore} >= 0 and ${table.newAwayScore} >= 0
      )`,
    ),
  ],
)

export const ratingConfigs = pgTable(
  'rating_configs',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull().unique(),
    algorithm: ratingAlgorithm('algorithm').notNull(),
    params: jsonb('params').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Exactly one active config. Same partial-index technique as sessions_one_open.
    uniqueIndex('rating_configs_one_active')
      .on(sql`(true)`)
      .where(sql`${table.isActive}`),
  ],
)

// CACHE. Derived by replay; safe to truncate and rebuild — see docs/DATABASE.md.
export const ratingSnapshots = pgTable(
  'rating_snapshots',
  {
    configId: uuid('config_id')
      .notNull()
      .references(() => ratingConfigs.id, { onDelete: 'cascade' }),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    matchSequence: bigint('match_sequence', { mode: 'number' }).notNull(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id),
    ratingBefore: doublePrecision('rating_before').notNull(),
    ratingAfter: doublePrecision('rating_after').notNull(),
    expectedScore: doublePrecision('expected_score').notNull(),
    actualScore: doublePrecision('actual_score').notNull(), // 1, 0.5, 0
    delta: doublePrecision('delta').notNull(),
    gamesPlayedAfter: integer('games_played_after').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.configId, table.matchId, table.playerId] }),
    index('snapshots_player_idx').on(table.configId, table.playerId, table.matchSequence.desc()),
  ],
)
