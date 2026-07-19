"""Apply a SQL migration to the Supabase project via the Management API.

Usage: py -3 scripts/apply_migration.py supabase/migrations/00X_name.sql
Token: read from .env (SUPABASE_ACCESS_TOKEN=sbp_...), never committed.
"""
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_REF = "ghhenktihhjqnhtmacin"

def token():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("SUPABASE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("SUPABASE_ACCESS_TOKEN not found in .env")

def run_sql(sql: str):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read() or "null")

if __name__ == "__main__":
    path = ROOT / sys.argv[1]
    print(f"applying {path.name} ...")
    try:
        result = run_sql(path.read_text(encoding="utf-8"))
        print("ok:", json.dumps(result)[:500])
    except urllib.error.HTTPError as e:
        print("FAILED:", e.read().decode()[:1000])
        sys.exit(1)
