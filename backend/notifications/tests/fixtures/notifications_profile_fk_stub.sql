-- TEST-ONLY, OPT-IN. Emulates a notifications.user_id -> profiles.user_id FK (FK error 23503 when a
-- user has no profile row), which the service code anticipates. Production's actual schema is
-- unverified: check pg_constraint on public.notifications before relying on this behaviour.
-- NOT VALID: enforced for new rows only, so pre-existing seed rows do not block it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_profile_stub') THEN
        ALTER TABLE notifications
            ADD CONSTRAINT fk_notifications_profile_stub
            FOREIGN KEY (user_id) REFERENCES profiles (user_id) NOT VALID;
    END IF;
END $$;
