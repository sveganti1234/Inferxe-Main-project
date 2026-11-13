-- ==============================================================================
-- Inferxe RAG Chatbot & Document Metadata Supabase PostgreSQL Migration
-- Migration File: database/migrations/003_supabase_rag_tables.sql
-- Project: inferxe_Project (griymmcatsfwnfmqwgdd)
-- Architecture: Backend-mediated access via AWS Cognito & SUPABASE_SERVICE_ROLE_KEY
-- ==============================================================================

-- 1. Ensure pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. Table: document_metadata
-- Purpose: Ingested and uploaded document catalog with SHA-256 deduplication
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT,
    file_size_bytes BIGINT,
    file_hash TEXT,
    status TEXT DEFAULT 'processed',
    chunk_count INTEGER DEFAULT 0,
    uploaded_by TEXT REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Performance & Query Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_doc_metadata_doc_id
    ON public.document_metadata(document_id);

CREATE INDEX IF NOT EXISTS idx_doc_metadata_uploaded_by
    ON public.document_metadata(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_doc_metadata_org_id
    ON public.document_metadata(organization_id);

CREATE INDEX IF NOT EXISTS idx_doc_metadata_created_at
    ON public.document_metadata(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_metadata_file_hash
    ON public.document_metadata(file_hash);

-- Enable Row Level Security (RLS)
ALTER TABLE public.document_metadata ENABLE ROW LEVEL SECURITY;

-- Clean up any legacy or GoTrue auth policies
DROP POLICY IF EXISTS "Allow authenticated users to read document_metadata" ON public.document_metadata;
DROP POLICY IF EXISTS "Authenticated users read own organization documents" ON public.document_metadata;
DROP POLICY IF EXISTS "Service role full access on document_metadata" ON public.document_metadata;
DROP POLICY IF EXISTS "Service role access on document_metadata" ON public.document_metadata;

-- Trusted Service Role Access:
-- Only the trusted Python backend (possessing SUPABASE_SERVICE_ROLE_KEY) is granted access.
-- Direct anon or public access is strictly DENIED by RLS (Default Deny).
CREATE POLICY "Service role access on document_metadata"
    ON public.document_metadata
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);


-- ------------------------------------------------------------------------------
-- 3. Table: chat_history
-- Purpose: Multi-turn conversation turns, citations, and grounded verification
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    user_id TEXT REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    grounded BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'success',
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    processing_time_ms INTEGER DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Performance & Session Filtering Indexes
CREATE INDEX IF NOT EXISTS idx_chat_history_session_id
    ON public.chat_history(session_id);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_id
    ON public.chat_history(user_id);

CREATE INDEX IF NOT EXISTS idx_chat_history_org_id
    ON public.chat_history(organization_id);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_session
    ON public.chat_history(user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_chat_history_created_at
    ON public.chat_history(created_at ASC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

-- Clean up any legacy or GoTrue auth policies
DROP POLICY IF EXISTS "Allow users to read their own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Allow users to insert their own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Authenticated users read own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Authenticated users insert own chat history" ON public.chat_history;
DROP POLICY IF EXISTS "Service role full access on chat_history" ON public.chat_history;
DROP POLICY IF EXISTS "Service role access on chat_history" ON public.chat_history;

-- Trusted Service Role Access:
-- Only the trusted Python backend (possessing SUPABASE_SERVICE_ROLE_KEY) is granted access.
-- Direct anon or public access is strictly DENIED by RLS (Default Deny).
CREATE POLICY "Service role access on chat_history"
    ON public.chat_history
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
