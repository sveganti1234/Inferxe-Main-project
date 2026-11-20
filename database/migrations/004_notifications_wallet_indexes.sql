-- 004: indexes matching the notifications/wallet query patterns.
--
-- NOT applied automatically (init_db does not run this file).
-- PRODUCTION CHECK 2026-11-18 (read-only, no writes): only statement 1 is missing in the configured
-- Supabase project. Statements 2-4 are already covered there and are commented out below (statement 3
-- has a DIFFERENT NAME in production, so "IF NOT EXISTS" would have created a duplicate). For a database
-- created by init_db alone (local/test), statements 2-4 may still apply: run 004_validate.sql first. Apply manually, first on a
-- non-production copy, and compare EXPLAIN plans before and after.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block: run each statement on its own
-- (psql autocommit, or the Supabase SQL editor one statement at a time).
--
-- AFTER EACH STATEMENT, confirm the index is valid (check #9 in 004_validate.sql). If a CONCURRENTLY
-- build fails or is cancelled (e.g. duplicate keys for statement 4), Postgres leaves an INVALID index,
-- and re-running the same "IF NOT EXISTS" statement then SKIPS it while reporting success, leaving the
-- index unusable. Recovery: fix the cause, DROP INDEX CONCURRENTLY IF EXISTS <name>;, then re-run.
-- (Reproduced on an isolated PostgreSQL 18 database with a legacy-shaped outbox table.)
--
-- Queries these support (backend/notifications/service.py):
--   get_notifications:   WHERE user_id = ? [AND is_read = FALSE] ORDER BY created_at DESC, id DESC LIMIT/OFFSET
--   unread count:        WHERE user_id = ? AND is_read = FALSE
--   wallet history:      WHERE user_id = ? ORDER BY created_at DESC LIMIT/OFFSET

-- 1. Per-user notification list in the exact sort order (replaces a global created_at sort).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC, id DESC);

-- 2. Unread lookups/counts only touch unread rows.  OPTIONAL (review 2026-11-18): on the isolated test
--    database the existing idx_notifications_is_read (user_id, is_read) served the unread/count queries
--    (7,078 scans) while this index was barely used (51). Skip it unless production plans show otherwise.
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): covered by existing idx_notifications_user_read (user_id, is_read, created_at DESC). SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_unread
--     ON notifications (user_id)
--     WHERE is_read = FALSE;

-- 3. Per-user wallet history in sort order.
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): exists as idx_wallet_tx_user_date (user_id, created_at DESC); this name differs, so running it would DUPLICATE the index. SKIP.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wallet_tx_user_created
--     ON wallet_transactions (user_id, created_at DESC);

-- 4. Outbox idempotency must be enforced by a UNIQUE index. ONLY FOR LEGACY TABLES: run this
--    statement only if check #2 of 004_validate.sql returns no UNIQUE constraint. Tables created by
--    init_db already have UNIQUE(idempotency_key) (validated on an isolated init_db database), and
--    this would add a redundant third index on the same column. Legacy tables got the column added
--    without it, so concurrent duplicates could both pass. Check for duplicates first; the index
--    fails if any exist.
--
--    SELECT idempotency_key, COUNT(*) FROM notification_outbox
--    WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1;
--
-- PRODUCTION CHECK 2026-11-18 (read-only inspection): UNIQUE constraint notification_outbox_idempotency_key_key exists (0 duplicates). SKIP.
-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notification_outbox_idempotency_key
--     ON notification_outbox (idempotency_key);

-- After confirming with pg_stat_user_indexes on the real database, these become redundant:
--   idx_notifications_created_at (global sort; superseded by 1)
--   idx_outbox_status            (outbox rows are written as PROCESSED and never queried by status)
--   idx_outbox_idempotency_key   (non-unique duplicate of the UNIQUE constraint's index, where present)
--   idx_notifications_user_id    (same leading column as idx_notifications_user_created from 1)
--   idx_wallet_tx_user_id        (same leading column as idx_wallet_tx_user_created from 3)
-- DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_created_at;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_outbox_status;
-- DROP INDEX CONCURRENTLY IF EXISTS idx_outbox_idempotency_key;   -- only where the UNIQUE constraint exists
-- DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_user_id;    -- only after 1 is valid
-- DROP INDEX CONCURRENTLY IF EXISTS idx_wallet_tx_user_id;        -- only after 3 is valid
