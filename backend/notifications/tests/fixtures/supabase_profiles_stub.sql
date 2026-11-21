-- TEST-ONLY. Apply to an isolated test database after init_db; never to production.
-- Production's Supabase project owns public.profiles (no DDL for it exists in this repo). The live
-- notification/wallet suites insert into it, and the service treats FK error 23503 on notifications
-- as "user has no profile row". Whether production really has that FK is unverified, so it lives in
-- the separate opt-in fixture notifications_profile_fk_stub.sql.
CREATE TABLE IF NOT EXISTS profiles (
    user_id         TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL DEFAULT '',
    email           TEXT,
    username        TEXT,
    role            TEXT NOT NULL DEFAULT 'customer',
    status          TEXT NOT NULL DEFAULT 'active',
    auth_provider   TEXT,
    organization_id TEXT,
    created_at      TEXT,
    updated_at      TEXT
);
