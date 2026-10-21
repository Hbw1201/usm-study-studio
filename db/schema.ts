import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const workspaces = sqliteTable("study_workspaces", {
  userId: text("user_id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const studyUsers = sqliteTable("study_users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const studySessions = sqliteTable("study_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => studyUsers.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("study_sessions_expires_idx").on(table.expiresAt), index("study_sessions_user_idx").on(table.userId)]);

export const loginAttempts = sqliteTable("study_login_attempts", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("study_login_attempts_expires_idx").on(table.expiresAt)]);
