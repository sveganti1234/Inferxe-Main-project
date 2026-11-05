"""
create_api_key.py
=================
CLI utility to generate a customer API key, display the raw secret key ONCE,
and persist the SHA-256 hash into the PostgreSQL database.

Usage:
  python -m inference.scripts.create_api_key --name "Dev Key" --user "dev@inferxe.internal" --env live
"""

import sys
import uuid
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Add backend directory to path
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.database import SessionLocal, check_database_connection
from inference.models import APIKey
from inference.auth import generate_api_key


def main():
    parser = argparse.ArgumentParser(description="Create a new customer Inferxe API key")
    parser.add_argument("--name", default="Default Key", help="Name or label for the key")
    parser.add_argument("--user", default="dev@inferxe.internal", help="Customer user ID or email (e.g. Cognito sub)")
    parser.add_argument("--env", choices=["live", "test"], default="live", help="Environment (live or test)")
    args = parser.parse_args()

    if not check_database_connection():
        print("[ERROR] Cannot reach the PostgreSQL database server.")
        print("Please ensure PostgreSQL is running and DATABASE_URL in backend/.env is valid.")
        sys.exit(1)

    raw_key, key_prefix, key_hash = generate_api_key(environment=args.env)

    db = SessionLocal()
    try:
        new_key = APIKey(
            id=uuid.uuid4(),
            user_id=args.user,
            name=args.name,
            key_prefix=key_prefix,
            key_hash=key_hash,
            environment=args.env,
            is_active=True,
            created_at=datetime.now(timezone.utc)
        )
        db.add(new_key)
        db.commit()
        db.refresh(new_key)

        print("\n" + "=" * 65)
        print("Inferxe Customer API Key Created Successfully")
        print("=" * 65)
        print(f"Key ID:       {new_key.id}")
        print(f"Name:         {new_key.name}")
        print(f"User ID:      {new_key.user_id}")
        print(f"Prefix:       {new_key.key_prefix}")
        print(f"Environment:  {new_key.environment}")
        print(f"Active:       {new_key.is_active}")
        print(f"Hash (DB):    {new_key.key_hash[:16]}... (SHA-256)")
        print("-" * 65)
        print("YOUR SECRET API KEY (Save this now - it will never be shown again):")
        print(f"\n  {raw_key}\n")
        print("-" * 65)
        print("Example curl request:")
        print(f'  curl -X POST "http://127.0.0.1:8001/api/v1/inference" \\')
        print(f'       -H "Authorization: Bearer {raw_key}" \\')
        print(f'       -H "Content-Type: application/json" \\')
        print(f'       -d \'{{"prompt": "Explain GPU inference in simple words."}}\'')
        print("=" * 65 + "\n")

    except Exception as e:
        db.rollback()
        print(f"[ERROR] Failed to save key: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

