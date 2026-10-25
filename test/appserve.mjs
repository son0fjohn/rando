// Static server for the browser tests. Besides plain files under the repo it
// serves two assembled pages:
//   /app.html          the REAL app (web/index.html) with the CDN imports
//                      mapped offline: three -> node_modules, supabase-js ->
//                      test/stubs/supabase.js (see that file for the fake data)
//   test/*.html        test pages, with index.html's CSS inlined where they
//                      say <!--INDEX_CSS--> (hpparty.html, diaryfit.html)
// Pass { realAvatars: true } to keep the real avatar3 models on hpparty.html.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".glb": "model/gltf-binary", ".svg": "image/svg+xml", ".webp": "image/webp", ".mp3": "audio/mpeg" };
const IMPORTS = `<script type="importmap">
{ "imports": {
  "https://esm.sh/three@0.160.0": "/node_modules/three/build/three.module.js",
  "https://esm.sh/three@0.160.0/": "/node_modules/three/",
  "three": "/node_modules/three/build/three.module.js",
  "https://esm.sh/@supabase/supabase-js@2": "/test/stubs/supabase.js"
} }
</script>`;

export async function serve({ realAvatars = false, port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split("?")[0]);
      let body, p;
      if (url === "/app.html") {
        p = "app.html";
        const html = await readFile(join(ROOT, "web/index.html"), "utf8");
        body = Buffer.from(html.replace("<head>", `<head>\n<base href="/web/">\n${IMPORTS}`));
      } else {
        p = join(ROOT, normalize(url).replace(/^(\.\.[/\\])+/, ""));
        body = await readFile(p);
        if (p.endsWith(".html") && body.includes("<!--INDEX_CSS-->")) {
          const html = await readFile(join(ROOT, "web/index.html"), "utf8");
          const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>") + "</style>".length);
          let s = body.toString().replace("<!--INDEX_CSS-->", css);
          if (realAvatars) s = s.replace(/\s*"\/web\/avatar[34]\.js": "[^"]+",?/g, "");
          body = Buffer.from(s);
        }
      }
      res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// `npm run serve:test`: the same server on a fixed port, to play by hand.
// Tabs in one browser form a party (BroadcastChannel), no Supabase needed.
if (import.meta.url === `file://${process.argv[1]}`) {
  // (tabs only share a party within one origin: open every tab on the same
  // host, localhost or 127.0.0.1, in the same browser window and profile)
  const { base } = await serve({ port: Number(process.env.PORT) || 8744 });
  const url = base.replace("127.0.0.1", "localhost");
  console.log(`offline party: ${url}/test/hpparty.html?me=alice  (create a party, then open ?me=bob&party=CODE and ?me=cy&party=CODE in more tabs)`);
  console.log(`real app, Supabase faked: ${url}/app.html`);
  console.log("every tab on that same localhost address, in the same browser window: tabs only see each other within one origin");
}
