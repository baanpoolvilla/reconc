CREATE INDEX `idx_audit_events_created_at` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_created_at` ON `documents` (`created_at`);--> statement-breakpoint
PRAGMA optimize;
