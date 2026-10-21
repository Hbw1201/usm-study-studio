CREATE TABLE `study_login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `study_login_attempts_expires_idx` ON `study_login_attempts` (`expires_at`);--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `study_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_sessions_expires_idx` ON `study_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `study_sessions_user_idx` ON `study_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `study_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `study_users_username_unique` ON `study_users` (`username`);