"""Is the production Supabase project set up for notes on the map?

Usage: python3 scripts/check_notes_setup.py
Token: SUPABASE_ACCESS_TOKEN in .env (like scripts/apply_migration.py), never committed.

Read-only. Runs scripts/notes_setup_check.sql through the Management API and
looks at the moderate-note Edge Function and its secrets (names only), then
prints what's missing and the exact command that fixes it (docs/notes.md
"Set up"). Exit code 0 when everything is there, 1 otherwise.
"""
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from apply_migration import PROJECT_REF, ROOT, run_sql, token  # noqa: E402

API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}"


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"Authorization": f"Bearer {token()}", "User-Agent": "rando-migrations/1.0"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read() or "null")


def main():
    problems = []
    fix = lambda what, how: problems.append((what, how))  # noqa: E731

    rows = run_sql((ROOT / "scripts/notes_setup_check.sql").read_text(encoding="utf-8"))
    s = rows[-1]["notes_setup"] if isinstance(rows, list) and rows else {}
    if isinstance(s, str):
        s = json.loads(s)
    print("database:", json.dumps(s, indent=1, sort_keys=True))

    fns = s.get("functions") or {}
    if not all((s.get("tables") or {}).values()) or not all(fns.values()):
        missing = [k for k, v in {**(s.get("tables") or {}), **fns}.items() if not v]
        fix(f"019_notes.sql isn't applied (missing: {', '.join(missing)})",
            "python3 scripts/apply_migration.py supabase/migrations/019_notes.sql   (then 020, below)")
    else:
        if not s.get("granted"):
            fix("signed-in players can't call the note functions", "re-apply supabase/migrations/019_notes.sql (its grants)")
        if not s.get("anon_blocked"):
            fix("anon can call the note functions", "re-apply supabase/migrations/019_notes.sql (its revokes)")
        if not s.get("no_verify"):
            fix("leave_note still asks for a verified phone (020 not applied, or 019 re-applied after it)",
                "python3 scripts/apply_migration.py supabase/migrations/020_notes_no_verify.sql")
    b = s.get("buckets") or {}
    if not s.get("storage"):
        fix("no Storage schema in this project", "turn on Storage in the dashboard, then re-apply 019_notes.sql")
    else:
        up, pub = b.get("note-uploads"), b.get("notes")
        if not up or up.get("public"):
            fix("the private 'note-uploads' bucket is missing (or public)", "re-apply 019_notes.sql, or Storage -> New bucket 'note-uploads', private, 2 MB, image/jpeg")
        if not pub or not pub.get("public"):
            fix("the public 'notes' bucket is missing (or private)", "re-apply 019_notes.sql, or Storage -> New bucket 'notes', public, 2 MB, image/jpeg")
        if sorted(s.get("policies") or []) != ["note_uploads_insert", "note_uploads_read"]:
            fix("the note-uploads policies are missing (photos and memes can't upload)",
                "re-apply 019_notes.sql; if it warns it may not create policies on storage.objects, add them in Storage -> Policies "
                "(note-uploads: INSERT and SELECT for authenticated, (storage.foldername(name))[1] = auth.uid()::text)")

    # the image check: deployed, and with a provider key
    try:
        funcs = get("/functions") or []
        f = next((x for x in funcs if x.get("slug") == "moderate-note"), None)
        print("moderate-note:", json.dumps({k: f.get(k) for k in ("status", "version", "verify_jwt", "updated_at")} if f else None))
        if not f or f.get("status") != "ACTIVE":
            fix("the moderate-note Edge Function isn't deployed (photos and memes stay pending: only their author sees them)",
                "supabase functions deploy moderate-note --project-ref " + PROJECT_REF)
        names = {x.get("name") for x in (get("/secrets") or [])}
        print("secrets (names):", sorted(n for n in names if n in ("OPENAI_API_KEY", "GOOGLE_VISION_KEY", "MODERATION_PROVIDER")))
        if "OPENAI_API_KEY" not in names and "GOOGLE_VISION_KEY" not in names:
            fix("moderate-note has no provider key (pictures stay pending, fail closed)",
                "supabase secrets set OPENAI_API_KEY=sk-... --project-ref " + PROJECT_REF + "   (or MODERATION_PROVIDER=google GOOGLE_VISION_KEY=...)")
    except urllib.error.HTTPError as e:
        fix(f"couldn't read the Edge Functions / secrets ({e.code})", "check them in the dashboard: Edge Functions -> moderate-note, and its secrets")
    if (s.get("stuck_pending") or 0) > 0:
        fix(f"{s['stuck_pending']} picture(s) pending for 5+ minutes",
            "once the function has a key: curl -X POST https://" + PROJECT_REF + ".supabase.co/functions/v1/moderate-note "
            "-H 'Authorization: Bearer <service role key>' -H 'content-type: application/json' -d '{\"sweep\": true}'")

    print()
    if not problems:
        print("notes: all set up")
        return 0
    for what, how in problems:
        print(f"MISSING  {what}\n   fix:  {how}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
