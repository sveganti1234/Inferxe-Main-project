-- Validation for 004_notifications_wallet_indexes.sql. READ-ONLY: changes no data or schema.
-- Run against a non-production copy first (psql or the Supabase SQL editor), then compare the
-- EXPLAIN output before and after applying 004. Pass a real heavy user id (psql quotes it via :'uid';
-- do not add quotes yourself), e.g.
--   psql -v uid=<user-id> -f database/migrations/004_validate.sql

-- 1. Blocking check for the UNIQUE index: must return zero rows before applying 004.
SELECT idempotency_key, COUNT(*) AS copies
FROM notification_outbox
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1
ORDER BY copies DESC
LIMIT 50;

-- 2. Is idempotency already enforced? (a UNIQUE constraint from init_db's CREATE TABLE counts)
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'notification_outbox'::regclass AND c.contype = 'u';

-- 3. Existing indexes on the affected tables (spot overlaps with 004).
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('notifications', 'wallet_transactions', 'notification_outbox')
ORDER BY tablename, indexname;

-- 4. Column types the new indexes rely on (created_at is TEXT holding ISO-8601 strings:
--    lexical order equals time order only while every value uses the same format and offset).
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (('notifications', 'created_at'), ('notifications', 'is_read'),
                                    ('wallet_transactions', 'created_at'), ('notification_outbox', 'idempotency_key'));

-- 5. Timestamp format consistency (should return one or very few distinct shapes).
SELECT regexp_replace(created_at, '[0-9]', '9', 'g') AS shape, COUNT(*)
FROM notifications GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- 6. Table sizes: index builds take longer on big tables (CONCURRENTLY avoids blocking writes).
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
WHERE relname IN ('notifications', 'wallet_transactions', 'notification_outbox');

-- 7. Query plans for the hot queries. EXPLAIN without ANALYZE does not execute the query.
--    Use EXPLAIN (ANALYZE, BUFFERS) only on the non-production copy.
EXPLAIN SELECT * FROM notifications WHERE user_id = :'uid'
ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET 0;

EXPLAIN SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_read = FALSE) AS unread
FROM notifications WHERE user_id = :'uid';

EXPLAIN SELECT * FROM wallet_transactions WHERE user_id = :'uid'
ORDER BY created_at DESC LIMIT 50 OFFSET 0;

-- 8. After applying 004 and running normal traffic for a while: confirm the new indexes are used
--    and whether the older ones are now idle (candidates for the commented DROPs in 004).
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE relname IN ('notifications', 'wallet_transactions', 'notification_outbox')
ORDER BY relname, idx_scan;

-- 9. Index validity: every row must show indisvalid = true. An INVALID index means a CONCURRENTLY
--    build failed or was cancelled; "CREATE INDEX ... IF NOT EXISTS" will not repair it. Drop it with
--    DROP INDEX CONCURRENTLY IF EXISTS <name>; fix the cause (e.g. duplicates from check #1) and re-run.
SELECT c.relname AS index_name, i.indisvalid, i.indisready
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname IN ('idx_notifications_user_created', 'idx_notifications_user_unread',
                    'idx_wallet_tx_user_created', 'uq_notification_outbox_idempotency_key');
