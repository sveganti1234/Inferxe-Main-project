-- Migration 009: Customer Workspace Storage Files
-- Stores metadata and structure for customer-scoped workspace files and folders.
-- The underlying file objects are persisted in Supabase Storage bucket 'workspace-files' under '${user_id}/...'.

CREATE TABLE IF NOT EXISTS customer_workspace_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    path TEXT NOT NULL,
    folder_path TEXT NOT NULL DEFAULT '/',
    is_folder BOOLEAN NOT NULL DEFAULT FALSE,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) DEFAULT 'application/octet-stream',
    storage_bucket VARCHAR(64) NOT NULL DEFAULT 'workspace-files',
    storage_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT customer_workspace_files_unique_item UNIQUE (user_id, folder_path, name)
);

CREATE INDEX IF NOT EXISTS idx_customer_workspace_files_user_folder
    ON customer_workspace_files (user_id, folder_path);

CREATE INDEX IF NOT EXISTS idx_customer_workspace_files_user_usage
    ON customer_workspace_files (user_id, is_folder);

ALTER TABLE customer_workspace_files ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'customer_workspace_files'
        AND policyname = 'service_role_full_access_workspace_files'
    ) THEN
        CREATE POLICY service_role_full_access_workspace_files
            ON customer_workspace_files
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
