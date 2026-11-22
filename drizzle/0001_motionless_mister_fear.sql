CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`previous_hash` text NOT NULL,
	`current_hash` text NOT NULL,
	`timestamp` text NOT NULL
);
