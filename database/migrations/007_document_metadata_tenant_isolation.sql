-- 007: tenant-isolation columns for public.document_metadata (RAG documents).
--
-- STATUS: PROPOSED, NOT APPLIED. Review with the TL / database owner; apply on a non-production copy first.
-- Safe to re-run (idempotent). Non-destructive: only adds columns, a constraint and an index.
--
-- Why (P0 #3 RAG remediation, backend/rag/server.py + backend/notifications/main.py):
--   * visibility: 'public' (shared knowledge base, admin-uploaded), 'organization' (only that organization), or
--     'quarantined'. EXISTING ROWS BECOME 'quarantined' (the column default fills them): they were uploaded
--     before isolation with untrusted organization data, so they are never listed to customers and their
--     vectors (no security tags) are never retrieved. An admin re-uploads documents that should stay available.
--   * uploaded_by_admin_id: uploads are admin-only now, and admins live in admin_users, not profiles; the
--     existing uploaded_by column references profiles(user_id) and stays NULL for admin uploads.
--   * status may now be 'failed' (indexing did not happen); no constraint existed on status, none is added.
-- RLS: unchanged (already enabled, service-role-only policy from 003); the backend uses the service role.

BEGIN;

ALTER TABLE public.document_metadata
    ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'quarantined';

ALTER TABLE public.document_metadata
    ADD COLUMN IF NOT EXISTS uploaded_by_admin_id TEXT;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.document_metadata'::regclass AND conname = 'document_metadata_visibility_check'
    ) THEN
        ALTER TABLE public.document_metadata
            ADD CONSTRAINT document_metadata_visibility_check
            CHECK (visibility IN ('public', 'organization', 'quarantined'));
    END IF;
    -- An organization document must name its organization.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.document_metadata'::regclass AND conname = 'document_metadata_org_visibility_check'
    ) THEN
        ALTER TABLE public.document_metadata
            ADD CONSTRAINT document_metadata_org_visibility_check
            CHECK (visibility <> 'organization' OR organization_id IS NOT NULL) NOT VALID;
        -- NOT VALID: existing rows are 'quarantined', so validation cannot fail, but avoids a full-table check lock.
        ALTER TABLE public.document_metadata VALIDATE CONSTRAINT document_metadata_org_visibility_check;
    END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_doc_metadata_org_visibility
    ON public.document_metadata (organization_id, visibility);

COMMIT;

-- Validation (read-only):
-- SELECT visibility, count(*) FROM public.document_metadata GROUP BY 1;       -- legacy rows: 'quarantined'
-- SELECT conname FROM pg_constraint WHERE conrelid = 'public.document_metadata'::regclass AND conname LIKE '%visibility%';

-- Rollback (removes isolation metadata; the application then cannot list organization documents correctly):
-- BEGIN;
-- DROP INDEX IF EXISTS public.idx_doc_metadata_org_visibility;
-- ALTER TABLE public.document_metadata DROP CONSTRAINT IF EXISTS document_metadata_org_visibility_check;
-- ALTER TABLE public.document_metadata DROP CONSTRAINT IF EXISTS document_metadata_visibility_check;
-- ALTER TABLE public.document_metadata DROP COLUMN IF EXISTS uploaded_by_admin_id;
-- ALTER TABLE public.document_metadata DROP COLUMN IF EXISTS visibility;
-- COMMIT;
