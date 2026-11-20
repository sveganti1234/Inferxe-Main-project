"""These scripts call a running dev server on 127.0.0.1:8000 when imported. That server uses the real
backend/.env (production Supabase), so they are live tests: collected only with INFERXE_LIVE_SUPABASE_TESTS=1."""

import os

LIVE_SERVICE_SCRIPTS = ["test_privacy_rules.py", "test_live_queries.py", "test_rag_pipeline.py"]

collect_ignore = [] if os.environ.get("INFERXE_LIVE_SUPABASE_TESTS") == "1" else LIVE_SERVICE_SCRIPTS
