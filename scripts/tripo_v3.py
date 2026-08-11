"""Tripo API v3 client (v2 retires 2026-11-01; v3 host is openapi.tripo3d.ai).

    py -3 scripts/tripo_v3.py balance
    py -3 scripts/tripo_v3.py upload path.jpg
    py -3 scripts/tripo_v3.py generate path.jpg out.glb [--model P1-20260311]
                              [--face-limit N] [--url https://...]
    py -3 scripts/tripo_v3.py task <task_id>

Surface (probed live 2026-08-11):
  GET  /v3/account/balance
  POST /v3/files                       multipart part "file" -> file_token
  POST /v3/generation/image-to-model   {model, file:{url|object|file_token},
                                        face_limit?} -> task_id
  GET  /v3/tasks/{uuid}                status success|failed|cancelled|banned,
                                       output.model_url (EXPIRES ~5 min —
                                       download immediately)

Models: P1-20260311 (low-poly — matches the Rando PS2 look), v2.5-20250123,
v3.0-20250812, v3.1-20260211. TRIPO_API_KEY comes from .env.
"""
import json
import mimetypes
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://openapi.tripo3d.ai/v3"
DEFAULT_MODEL = "P1-20260311"

def key():
    for line in open(os.path.join(ROOT, ".env")).read().splitlines():
        if line.startswith("TRIPO_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("TRIPO_API_KEY missing from .env")

def call(path, data=None, headers=None, method=None, timeout=120):
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": f"Bearer {key()}", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} {path}\n{e.read().decode(errors='replace')[:600]}")

def balance():
    return call("/account/balance")["data"]

def upload(path):
    boundary = "----randov3"
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; "
            f'name="file"; filename="{os.path.basename(path)}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n").encode() + \
        open(path, "rb").read() + f"\r\n--{boundary}--\r\n".encode()
    r = call("/files", data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}"})
    d = r["data"]
    return d.get("file_token") or d.get("token") or d.get("image_token") or d

def image_to_model(file_ref, model=DEFAULT_MODEL, face_limit=None, **extra):
    task = {"model": model, "file": file_ref, **extra}
    if face_limit:
        task["face_limit"] = face_limit
    r = call("/generation/image-to-model", data=json.dumps(task).encode(),
             headers={"Content-Type": "application/json"})
    return r["data"]["task_id"]

def wait(task_id, poll_s=8):
    while True:
        d = call(f"/tasks/{task_id}")["data"]
        st = d["status"]
        print(f"  ... {st} ({d.get('progress', '?')}%)")
        if st == "success":
            return d
        if st in ("failed", "cancelled", "banned"):
            raise SystemExit(f"task {st}: {json.dumps(d)[:600]}")
        time.sleep(poll_s)

def download(task_data, out_path):
    out = task_data.get("output") or {}
    url = (out.get("model_url") or out.get("pbr_model") or out.get("model")
           or out.get("base_model"))
    if not url:
        raise SystemExit(f"no model url in output: {json.dumps(out)[:400]}")
    urllib.request.urlretrieve(url, out_path)  # url expires ~5 min
    return out_path

def main():
    args = sys.argv[1:]
    if not args or args[0] == "balance":
        print(json.dumps(balance()))
        return
    if args[0] == "upload":
        print(json.dumps(upload(args[1])))
        return
    if args[0] == "task":
        print(json.dumps(call(f"/tasks/{args[1]}")["data"], indent=1)[:2000])
        return
    if args[0] == "generate":
        img, out = args[1], args[2]
        model = args[args.index("--model") + 1] if "--model" in args else DEFAULT_MODEL
        fl = int(args[args.index("--face-limit") + 1]) if "--face-limit" in args else None
        if "--url" in args:
            ref = {"url": args[args.index("--url") + 1]}
        else:
            ref = {"file_token": upload(img)}
            print(f"uploaded -> {ref['file_token']}")
        tid = image_to_model(ref, model=model, face_limit=fl)
        print(f"task {tid} (model {model})")
        d = wait(tid)
        download(d, out)
        print(f"saved {out} ({os.path.getsize(out) // 1024}KB)")
        return
    raise SystemExit(__doc__)

if __name__ == "__main__":
    main()
