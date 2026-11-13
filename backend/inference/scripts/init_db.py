"""
PostgreSQL database and table initialization script for the Inferxe Inference API.
Attempts to create the target database if missing and initializes required tables:
  1. api_keys
  2. inference_requests

Usage:
  python -m inference.scripts.init_db
"""

import sys
import logging
from pathlib import Path

# Add backend directory to path
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.database import (
    create_database_if_not_exists,
    init_db,
    check_database_connection,
    get_masked_url,
    DATABASE_URL,
    engine,
)
from inference.models import APIKey, InferenceRequest

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("inferxe.db_init")


def main():
    print("=" * 60)
    print("Inferxe Inference API - Database Setup")
    print("=" * 60)
    print(f"Target Database URL: {get_masked_url(DATABASE_URL)}\n")

    if "YOUR_PASSWORD" in DATABASE_URL:
        print("[ACTION NEEDED] Please configure your actual PostgreSQL password in backend/.env:")
        print("  Replace 'YOUR_PASSWORD' in DATABASE_URL with your local pgAdmin 4 password.")
        print("  Example: DATABASE_URL=postgresql+psycopg2://postgres:mysecretpassword@localhost:5432/inferxe_inference_db\n")
        sys.exit(1)

    print("[Step 1] Verifying / creating database...")
    created = create_database_if_not_exists(DATABASE_URL)
    if not created:
        print("\n[WARNING] Could not automatically create or verify the target database.")
        print("Please ensure:")
        print("  1. The PostgreSQL service is running.")
        print("  2. Your user and password in backend/.env (DATABASE_URL) are correct.")
        print("  3. Or create the database 'inferxe_inference_db' manually in pgAdmin 4.\n")

    print("[Step 2] Testing database connection...")
    if check_database_connection():
        print("-> Connection successful!")
        print("\n[Step 3] Initializing schema (creating tables: api_keys, inference_requests)...")
        try:
            init_db()
            print("-> Tables successfully created/verified in PostgreSQL:")
            print("     - api_keys")
            print("     - inference_requests")
            print("\n[SUCCESS] PostgreSQL schema is ready for the Inference API.")
        except Exception as e:
            print(f"[ERROR] Failed to create tables: {e}")
            sys.exit(1)
    else:
        print("[ERROR] Cannot reach the PostgreSQL database server.")
        print("\nTroubleshooting Steps:")
        print("  1. Start the PostgreSQL service:")
        print("       net start postgresql-x64-18  (Run in Admin PowerShell)")
        print("     or start it via Windows Services (services.msc) or pgAdmin 4.")
        print("  2. In backend/.env, update DATABASE_URL with your local pgAdmin password:")
        print("       DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/inferxe_inference_db")
        sys.exit(1)


if __name__ == "__main__":
    main()

