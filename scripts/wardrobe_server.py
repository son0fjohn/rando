"""Static server for the repo root + POST /__save?path=<repo-relative> (dev
only). scripts/wardrobe_extract.html uses it to write extracted garment
GLBs into web/avatar4/. Refuses paths outside web/avatar4 and assets/.

    python3 scripts/wardrobe_server.py [port=8743]
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = ("web/avatar4/", "assets/player/base-v4/")


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_POST(self):
        u = urlparse(self.path)
        rel = (parse_qs(u.query).get("path") or [""])[0]
        dst = os.path.normpath(os.path.join(ROOT, rel))
        ok = u.path == "/__save" and any(
            dst.startswith(os.path.join(ROOT, a)) for a in ALLOWED)
        if not ok:
            self.send_error(403, "path not allowed")
            return
        n = int(self.headers.get("Content-Length") or 0)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(f"saved {rel} ({n} bytes)".encode())

    def end_headers(self):
        # extracted GLBs are overwritten in place; a cached copy hides every fix
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8743
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
