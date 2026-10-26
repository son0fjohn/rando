// An invite link, /p/CODE?n=<party name>&c=<people inside> (vercel.json
// rewrites it here): a page whose link preview (KakaoTalk, iMessage,
// Instagram DMs) shows the night-sky card and "Jae's party · 4 inside", that
// sends the browser straight on to the app at /?party=CODE&from=invite.
// Parties live in no table, so the name and the count ride in the link (the
// count as it was when the link was shared). test/appserve.mjs serves the
// same page offline.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function invitePage({ code, name = "", count = 0, origin = "https://randoirl.vercel.app", app = "/", lang = "en" }) {
  code = String(code ?? "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return null;
  name = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  count = Math.max(0, Math.min(99, Math.floor(+count || 0)));
  const ko = /^ko/i.test(lang);
  const title = [name || (ko ? "파티 초대" : "You're invited to a party"), count ? (ko ? `${count}명 참여 중` : `${count} inside`) : ""].filter(Boolean).join(" · ");
  const desc = ko ? "Rando에서 같이 놀자! 탭하면 바로 들어와요. 설치도 가입도 필요 없어요." : "Party games for real life. Tap to join. Nothing to install, no sign-up.";
  const q = new URLSearchParams({ party: code, from: "invite" });
  if (name) q.set("n", name);
  if (count) q.set("c", String(count));
  const to = `${app}?${q}`;
  return `<!doctype html>
<html lang="${ko ? "ko" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Rando</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rando">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${origin}/p/${code}`)}">
<meta property="og:image" content="${esc(origin)}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The Rando logo glowing on a starry night sky">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(origin)}/og-image.png">
<meta name="theme-color" content="#0F1A3A">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0F1A3A;color:#FFC83D;font:800 28px -apple-system,"Apple SD Gothic Neo",sans-serif}</style>
</head><body><a href="${esc(to)}" style="color:inherit;text-decoration:none">Rando</a>
<script>location.replace(${JSON.stringify(to)});</script></body></html>`;
}

// Vercel: GET /p/CODE -> /api/invite?code=CODE&n=...&c=...
export default function handler(req, res) {
  const u = new URL(req.url, `https://${req.headers.host ?? "randoirl.vercel.app"}`);
  const html = invitePage({
    code: u.searchParams.get("code"), name: u.searchParams.get("n"), count: u.searchParams.get("c"),
    origin: `https://${req.headers.host ?? "randoirl.vercel.app"}`, lang: req.headers["accept-language"] ?? "en",
  });
  if (!html) { res.statusCode = 302; res.setHeader("location", "/"); res.end(); return; }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=60");
  res.end(html);
}
