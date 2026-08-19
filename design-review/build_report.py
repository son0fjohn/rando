"""Build the single-page report (report/rando-mechanics-lab.html) from
sim/results.json, design-review/combined.json, design-review/mechanics-review.md
and the brand SVGs. Self-contained (inline SVG, no external assets except
Google Fonts).

    py -3 design-review/build_report.py
"""
import html
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "report")
os.makedirs(OUT_DIR, exist_ok=True)

sim = json.load(open(os.path.join(ROOT, "sim", "results.json"), encoding="utf-8"))
comb = json.load(open(os.path.join(HERE, "combined.json"), encoding="utf-8"))
rows = comb["rows"]
ql = comb["quest_loop"]
review_md = open(os.path.join(HERE, "mechanics-review.md"), encoding="utf-8").read()


def svg_inline(path, cls=""):
    s = open(path, encoding="utf-8").read()
    s = re.sub(r"<\?xml[^>]*>", "", s)
    s = re.sub(r"\s(width|height)=\"[^\"]*\"", "", s, count=2)  # scale via CSS
    s = s.replace("<svg ", f'<svg class="{cls}" ', 1)
    s = s.replace('fill="#000"', 'fill="currentColor"')
    return s


ICONS = {k: svg_inline(os.path.join(ROOT, "brand", "icon", f"rando-silhouette-{k}.svg"), "mark")
         for k in ("front", "3q", "3q-left")}
WORDMARKS = []
for f in sorted(os.listdir(os.path.join(ROOT, "brand", "wordmark"))):
    if f.endswith(".svg") and not f.endswith("-live.svg"):
        WORDMARKS.append((f[0], f, svg_inline(os.path.join(ROOT, "brand", "wordmark", f), "wm")))
WM_META = {
    "A": ("Century Gothic Regular · lowercase · geometric",
          "Perfect circles in a, d, o echo the round head of the icon. Soft, approachable. Weakest at 16 px: thin strokes vanish."),
    "B": ("Segoe UI Semibold · Title case · humanist sans",
          "Closest thing on this machine to the SF-Pro restraint of the brief; reads as a product name on an app-store page; semibold survives the badge sizes."),
    "C": ("Bahnschrift SemiBold (DIN) · caps · tight",
          "Most legible of the four at 16–24 px and the most 'signage' in feel (a city/venue product). Least warm — the icon supplies the softness."),
    "D": ("Franklin Gothic Demi · lowercase · grotesque",
          "Heavy, compact, confident; holds weight in a 32 px badge; double-storey a gives it character. Risk: reads 'retail' rather than 'Apple-quiet'."),
}


def fmt_dur(s):
    return f"{s/60:.1f} min" if s >= 90 else f"{int(round(s))} s"


def chip(v):
    v = v or "—"
    cls = {"keep": "ok", "tweak": "warn", "rework": "warn", "cut": "bad"}.get(v, "mute")
    return f'<span class="chip {cls}">{html.escape(v)}</span>'


def pct(x):
    return f"{int(round(x * 100))}%"


# ---------------------------------------------------------------- ranked table
def table_rows():
    out = []
    mech = sim["mechanics"]
    for i, r in enumerate(rows, 1):
        name = r["mechanic"]
        m = mech[name]
        flags = "; ".join(r["flags"]) or "—"
        hard = any(f == "ZERO-INTERACTION" for f in r["flags"])
        flag_html = html.escape(flags)
        if hard:
            flag_html = flag_html.replace("ZERO-INTERACTION", '<b class="hard">ZERO-INTERACTION</b>')
        detail = []
        detail.append('<table class="sub"><thead><tr><th>n</th><th>pop</th><th>duration</th><th>resolve</th><th>degenerate</th>'
                      '<th>msg</th><th>tap</th><th>prox</th><th>p2p/pl/min</th><th>zero-p2p</th><th>particip.</th><th>agency</th><th>top-skill wins</th></tr></thead><tbody>')
        for n in ("2", "4", "8", "16"):
            c = m["by_n"].get(n)
            if not c:
                detail.append(f'<tr><td class="num">{n}</td><td colspan="12" class="mute">rules don’t allow</td></tr>')
                continue
            for pop in ("mixed", "antisocial"):
                a = c[pop]
                top = next(iter(a["degenerate_breakdown"].items()), None)
                dg = pct(a["degenerate_rate"]) + (f' <span class="mute">{html.escape(top[0])}</span>' if top else "")
                ts = "—" if a["top_skill_win_rate"] is None else pct(a["top_skill_win_rate"])
                detail.append(f'<tr><td class="num">{n}</td><td>{pop}</td><td class="num">{fmt_dur(a["duration_mean_s"])}</td>'
                              f'<td class="num">{pct(a["resolve_rate"])}</td><td class="num">{dg}</td><td class="num">{a["inter_msg"]}</td>'
                              f'<td class="num">{a["inter_tap"]}</td><td class="num">{a["inter_prox"]}</td><td class="num">{a["inter_ppm"]}</td>'
                              f'<td class="num">{pct(a["zero_p2p_frac"])}</td><td class="num">{pct(a["participation"])}</td>'
                              f'<td class="num">{pct(a["active_frac"])}</td><td class="num">{ts}</td></tr>')
        detail.append("</tbody></table>")
        notes = (f'<div class="notes"><p><b>JB</b> {chip(r["jb"])} {html.escape(r["jb_note"])}</p>'
                 f'<p><b>MP</b> {chip(r["mp"])} {html.escape(r["mp_note"])}</p></div>')
        out.append(
            f'<tr class="row" data-tier="{r["family"]}" data-lane="{r["arch"]}" data-sim="{r["sim_verdict"]}">'
            f'<td class="num rank">{i}</td>'
            f'<td class="name"><details><summary><span class="nm">{html.escape(name)}</span>'
            f'<span class="sub-label">{r["family"]} · {r["arch"]}</span></summary>'
            f'<div class="detail">{"".join(detail)}{notes}</div></details></td>'
            f'<td class="num">{r["best_n"]}</td>'
            f'<td class="num">{fmt_dur(r["duration_s"])}<span class="range">{fmt_dur(r["duration_range_s"][0])}–{fmt_dur(r["duration_range_s"][1])}</span></td>'
            f'<td class="num">{r["inter_ppm"]}</td>'
            f'<td class="num">{pct(r["resolve"])}</td>'
            f'<td class="num">{pct(r["degenerate"])}</td>'
            f'<td class="num">{pct(r["zero_p2p"])}</td>'
            f'<td class="flags">{flag_html}</td>'
            f'<td>{chip(r["sim_verdict"])}</td><td>{chip(r["jb"])}</td><td>{chip(r["mp"])}</td>'
            f'<td class="agree">{html.escape(r["agreement"])}</td></tr>')
    return "\n".join(out)


def quest_rows():
    out = []
    for k, q in ql.items():
        fill = fmt_dur(q["fill_time_mean_s"]) if q["fill_time_mean_s"] is not None else "—"
        out.append(f'<tr><td>{html.escape(k)}</td><td>{q["game"]}</td><td class="num">{q["min_players"]}</td>'
                   f'<td class="num">{q["arrivals_per_hour"]}</td><td class="num">{q["games_per_hour"]}</td>'
                   f'<td class="num">{q["players_served_per_hour"]}</td><td class="num">{q["stuck_lobbies_per_hour"]}</td>'
                   f'<td class="num">{q["abandoned_per_hour"]}</td><td class="num">{fill}</td>'
                   f'<td class="num">{fmt_dur(q["dead_air_mean_s"])}</td><td class="num">{fmt_dur(q["dead_air_p90_s"])}</td>'
                   f'<td class="num">{q["avg_game_size"] or "—"}</td>'
                   f'<td class="num">{q["spectator_share"] if q["spectator_share"] is not None else "—"}</td>'
                   f'<td class="num">{pct(q["no_game_hours_frac"])}</td></tr>')
    return "\n".join(out)


# ---------------------------------------------------------------- review md -> html (minimal converter)
def md_to_html(md):
    lines = md.split("\n")
    out, in_table, in_list = [], False, False
    def inline(t):
        t = html.escape(t, quote=False)
        t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        t = re.sub(r"\*(.+?)\*", r"<i>\1</i>", t)
        t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
        return t
    for ln in lines:
        if ln.startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if all(re.fullmatch(r"-+", c) for c in cells):
                continue
            if not in_table:
                out.append('<div class="tw"><table class="rv"><tbody>')
                in_table = True
                out.append("<tr>" + "".join(f"<th>{inline(c)}</th>" for c in cells) + "</tr>")
            else:
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</tbody></table></div>")
            in_table = False
        if ln.startswith("# "):
            continue  # page has its own title
        if ln.startswith("## "):
            if in_list: out.append("</ol>"); in_list = False
            out.append(f'<h3>{inline(ln[3:])}</h3>')
        elif ln.startswith("### "):
            if in_list: out.append("</ol>"); in_list = False
            out.append(f'<h4>{inline(ln[4:])}</h4>')
        elif re.match(r"^\d+\. ", ln):
            if not in_list:
                out.append("<ol>"); in_list = True
            out.append(f"<li>{inline(re.sub(r'^\d+\. ', '', ln))}</li>")
        elif ln.startswith("- "):
            if not in_list:
                out.append("<ul>"); in_list = "ul"
            out.append(f"<li>{inline(ln[2:])}</li>")
        elif ln.strip() == "---":
            if in_list: out.append("</ol>" if in_list is True else "</ul>"); in_list = False
            out.append("<hr>")
        elif ln.strip() == "":
            if in_list:
                out.append("</ol>" if in_list is True else "</ul>"); in_list = False
        else:
            out.append(f"<p>{inline(ln)}</p>")
    if in_table:
        out.append("</tbody></table></div>")
    if in_list:
        out.append("</ol>" if in_list is True else "</ul>")
    return "\n".join(out)


# ---------------------------------------------------------------- summary numbers
from collections import Counter
simc = Counter(r["sim_verdict"] for r in rows)
agree = sum(1 for r in rows if r["agreement"] == "all agree")
designers_agree = sum(1 for r in rows if r["jb"] == r["mp"])
hard = [r["mechanic"] for r in rows if "ZERO-INTERACTION" in r["flags"]]

wm_blocks = []
for oid, fname, svg in WORDMARKS:
    title, why = WM_META[oid]
    wm_blocks.append(f'''
  <div class="wm-opt">
    <div class="wm-head"><span class="opt">{oid}</span><span>{html.escape(title)}</span><code>brand/wordmark/{html.escape(fname)}</code></div>
    <div class="wm-large">{svg}</div>
    <div class="wm-sizes">
      <div><span class="lbl">48 px</span><span style="height:48px">{svg}</span></div>
      <div><span class="lbl">24 px</span><span style="height:24px">{svg}</span></div>
      <div><span class="lbl">16 px</span><span style="height:16px">{svg}</span></div>
      <div class="lockup"><span class="lbl">lockup</span><span class="lk">{ICONS["front"]}{svg}</span></div>
    </div>
    <p class="why">{html.escape(why)}</p>
  </div>''')

page = f'''<meta charset="utf-8">
<title>Rando Mechanics Lab</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {{
  --bg:#F3F4F2; --paper:#FFFFFF; --ink:#1B1D20; --muted:#6A7078; --rule:#D9DCD6; --soft:#E9EBE6;
  --accent:#2E5E8C; --ok:#2E7D4F; --warn:#A86E12; --bad:#B23A3A; --okbg:#E3F1E8; --warnbg:#F6EBD6; --badbg:#F6E1E1; --mutebg:#ECEEEA;
  --sans:"IBM Plex Sans",-apple-system,"Segoe UI",Helvetica,Arial,sans-serif; --mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg:#141618; --paper:#1C1F23; --ink:#E8E9E6; --muted:#9AA0A8; --rule:#2E3238; --soft:#23272C;
  --accent:#7FB0DE; --ok:#7CCB9A; --warn:#E0B062; --bad:#E38A8A; --okbg:#1C3A29; --warnbg:#3B2F14; --badbg:#3E2222; --mutebg:#262A2F;
}} }}
:root[data-theme="dark"] {{
  --bg:#141618; --paper:#1C1F23; --ink:#E8E9E6; --muted:#9AA0A8; --rule:#2E3238; --soft:#23272C;
  --accent:#7FB0DE; --ok:#7CCB9A; --warn:#E0B062; --bad:#E38A8A; --okbg:#1C3A29; --warnbg:#3B2F14; --badbg:#3E2222; --mutebg:#262A2F;
}}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 var(--sans); }}
a {{ color:var(--accent) }}
code {{ font-family:var(--mono); font-size:.85em; background:var(--soft); padding:1px 5px; border-radius:3px; }}
h1,h2,h3,h4 {{ text-wrap:balance; line-height:1.2; margin:0 0 .5em; font-weight:600 }}
h1 {{ font-size:28px; letter-spacing:-.01em }}
h2 {{ font-size:21px; margin-top:0; padding-top:8px }}
h3 {{ font-size:17px; margin-top:1.6em }}
h4 {{ font-size:15px; margin-top:1.3em; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.06em; font-size:12px }}
p {{ margin:0 0 .9em }}
hr {{ border:0; border-top:1px solid var(--rule); margin:2em 0 }}
.wrap {{ max-width:1180px; margin:0 auto; padding:0 28px 80px }}
.measure {{ max-width:720px }}
header.top {{ padding:40px 0 18px; border-bottom:1px solid var(--rule); }}
header.top .kicker {{ font-family:var(--mono); font-size:12px; color:var(--muted); letter-spacing:.04em; margin-bottom:10px }}
header.top p.lede {{ color:var(--muted); font-size:16px; max-width:760px; margin-top:6px }}
nav.toc {{ position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid var(--rule); display:flex; gap:22px; padding:10px 0; font-size:13px; font-weight:500 }}
nav.toc a {{ text-decoration:none; color:var(--muted) }}
nav.toc a:hover {{ color:var(--ink) }}
section {{ padding-top:36px }}
.strip {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin:22px 0 8px }}
.stat {{ background:var(--paper); border:1px solid var(--rule); border-radius:8px; padding:12px 14px }}
.stat .v {{ font-family:var(--mono); font-size:22px; font-weight:500; letter-spacing:-.01em }}
.stat .k {{ font-size:12px; color:var(--muted); margin-top:2px }}
.picks {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin-top:18px }}
.pick {{ background:var(--paper); border:1px solid var(--rule); border-radius:8px; padding:14px 16px }}
.pick h4 {{ margin:0 0 8px }}
.pick ol {{ margin:0; padding-left:18px }}
.pick li {{ margin:3px 0 }}
.chip {{ display:inline-block; font:500 11.5px/1 var(--mono); padding:4px 8px; border-radius:999px; white-space:nowrap }}
.chip.ok {{ color:var(--ok); background:var(--okbg) }} .chip.warn {{ color:var(--warn); background:var(--warnbg) }}
.chip.bad {{ color:var(--bad); background:var(--badbg) }} .chip.mute {{ color:var(--muted); background:var(--mutebg) }}
.tw {{ overflow-x:auto; border:1px solid var(--rule); border-radius:8px; background:var(--paper) }}
table {{ border-collapse:collapse; width:100%; font-size:13px }}
th {{ text-align:left; font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding:10px 10px; border-bottom:1px solid var(--rule); background:var(--paper); position:sticky; top:41px; white-space:nowrap; cursor:pointer }}
th.num, td.num {{ text-align:right; font-family:var(--mono); font-variant-numeric:tabular-nums }}
td {{ padding:9px 10px; border-bottom:1px solid var(--rule); vertical-align:top }}
tr.row:hover td {{ background:var(--soft) }}
td.name {{ min-width:240px }}
td.name summary {{ cursor:pointer; list-style:none; display:flex; flex-direction:column; gap:2px }}
td.name summary::-webkit-details-marker {{ display:none }}
td.name .nm {{ font-weight:600 }}
td.name .sub-label {{ font-size:11.5px; color:var(--muted) }}
td .range {{ display:block; font-size:11px; color:var(--muted) }}
td.flags {{ max-width:280px; font-size:12px; color:var(--muted) }}
td.flags b.hard {{ color:var(--bad); font-weight:600 }}
td.agree {{ font-size:12px; color:var(--muted); min-width:150px }}
.detail {{ margin:10px 0 4px; padding:10px; background:var(--soft); border-radius:6px; font-size:12.5px }}
table.sub {{ font-size:12px; margin-bottom:8px }}
table.sub th {{ position:static; background:transparent; font-size:10.5px; padding:6px 8px; top:auto }}
table.sub td {{ padding:5px 8px; border-bottom:1px solid var(--rule) }}
.notes p {{ margin:6px 0 }}
.mute {{ color:var(--muted) }}
.filters {{ display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 12px; font-size:12.5px }}
.filters button {{ font:inherit; color:var(--ink); background:var(--paper); border:1px solid var(--rule); border-radius:999px; padding:5px 11px; cursor:pointer }}
.filters button.on {{ border-color:var(--accent); color:var(--accent) }}
.filters button:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px }}
.legend {{ font-size:12.5px; color:var(--muted); margin:10px 0 0 }}
.legend b {{ color:var(--ink); font-weight:600 }}
table.rv th {{ position:static; top:auto }}
table.rv td, table.rv th {{ padding:8px 10px; font-size:13px }}
ol, ul {{ padding-left:22px }}
li {{ margin:4px 0 }}
.takeaways {{ background:var(--paper); border:1px solid var(--rule); border-radius:8px; padding:14px 18px; margin-top:14px }}
/* brand */
.brand {{ background:#FFFFFF; color:#000; border:1px solid var(--rule); border-radius:10px; padding:28px 28px 22px; margin-top:14px }}
.brand .muted, .brand .lbl, .brand .why, .brand code {{ color:#6A7078 }}
.brand code {{ background:#F1F2EF }}
.brand h3 {{ color:#000 }}
.marks {{ display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:28px; align-items:end }}
.marks .mark {{ display:block; height:320px; width:auto }}
.marks .cap {{ font-size:12px; color:#6A7078; margin-top:8px; font-family:var(--mono) }}
.badges {{ display:flex; gap:22px; align-items:flex-end; margin-top:18px }}
.badges .b {{ display:flex; flex-direction:column; align-items:center; gap:6px; font-size:11px; color:#6A7078; font-family:var(--mono) }}
.badges .sq {{ background:#F1F2EF; border-radius:22%; display:flex; align-items:center; justify-content:center }}
.badges .sq .mark {{ height:78%; width:auto }}
.wm-opt {{ border-top:1px solid #E6E8E3; padding:22px 0 6px }}
.wm-head {{ display:flex; gap:14px; align-items:baseline; font-size:13px; color:#000; margin-bottom:10px; flex-wrap:wrap }}
.wm-head .opt {{ font-family:var(--mono); font-weight:500; background:#000; color:#fff; border-radius:4px; padding:2px 7px; font-size:12px }}
.wm-large {{ height:96px; display:flex; align-items:center; overflow-x:auto }}
.wm-large .wm {{ height:96px; width:auto }}
.wm-sizes {{ display:flex; gap:36px; align-items:flex-end; margin:16px 0 8px; flex-wrap:wrap }}
.wm-sizes > div {{ display:flex; flex-direction:column; gap:6px }}
.wm-sizes .wm {{ height:100%; width:auto; display:block }}
.wm-sizes span[style] {{ display:block }}
.wm-sizes .lbl {{ font-size:11px; font-family:var(--mono) }}
.lockup .lk {{ display:flex; align-items:center; gap:10px; height:36px }}
.lockup .lk .mark {{ height:36px; width:auto }}
.lockup .lk .wm {{ height:22px; width:auto }}
.why {{ font-size:13px; max-width:720px; margin:4px 0 0 }}
@media (max-width: 760px) {{ .marks {{ grid-template-columns:1fr 1fr }} .marks .mark {{ height:220px }} }}
@media (prefers-reduced-motion: reduce) {{ * {{ scroll-behavior:auto !important }} }}
</style>

<div class="wrap">
<header class="top">
  <div class="kicker">branch explore/mechanics-brand · sim/ · design-review/ · brand/ · 2026-08-19</div>
  <h1>Rando Mechanics Lab</h1>
  <p class="lede">Every proposed mechanic simulated at 2 / 4 / 8 / 16 players, reviewed through two party-game design lenses, and a first pass at the mark. One ranked table where the numbers and the judgment sit side by side.</p>
</header>
<nav class="toc"><a href="#sim">1 · Simulation</a><a href="#review">2 · Design review</a><a href="#brand">3 · Logo &amp; wordmark</a><a href="#files">Files</a></nav>

<section id="sim">
<h2>1 · Simulate and rank every mechanic</h2>
<div class="measure">
<p>Headless harness: rule-based agents with traits (skill, sociability, speed, bluffing, greed, reaction time) play each mechanic {comb["rounds"]} times per headcount, in two populations. <b>Mixed</b> is a realistic spread. <b>Antisocial</b> forces sociability to zero — nobody says anything optional — so whatever interaction survives is <i>structural</i>. A mechanic that still completes rounds with zero player-to-player actions there can complete with zero interaction: hard flag, verdict cut. Interaction counts only actions aimed at another player (messages to someone, votes/guesses/tosses at someone, physical proximity events) — tapping a boss, pressing a button or answering trivia never counts.</p>
</div>
<div class="strip">
  <div class="stat"><div class="v">29</div><div class="k">mechanics modelled</div></div>
  <div class="stat"><div class="v">{simc["keep"]} · {simc["rework"]} · {simc["cut"]}</div><div class="k">sim keep · rework · cut</div></div>
  <div class="stat"><div class="v">{len(hard)}</div><div class="k">hard-flagged: can complete with zero interaction</div></div>
  <div class="stat"><div class="v">{agree}/29</div><div class="k">sim + both designers agree outright</div></div>
  <div class="stat"><div class="v">{designers_agree}/29</div><div class="k">the two designers agree with each other</div></div>
</div>
<div class="filters" role="group" aria-label="filter table">
  <button class="on" data-f="all">all</button>
  <button data-f="tier:signature">signature</button><button data-f="tier:catalog">catalog</button><button data-f="tier:unshaped">not yet shaped</button><button data-f="tier:superseded">superseded</button>
  <button data-f="lane:chill">chill</button><button data-f="lane:chaos">chaos</button><button data-f="lane:sporty">sporty</button>
  <button data-f="sim:keep">sim keep</button><button data-f="sim:rework">sim rework</button><button data-f="sim:cut">sim cut</button>
</div>
<div class="tw"><table id="rank">
<thead><tr><th class="num" data-k="0">#</th><th data-k="1">Mechanic <span class="mute">(click a name for per-headcount detail + persona notes)</span></th><th class="num" data-k="2">Best n</th><th class="num" data-k="3">Duration</th><th class="num" data-k="4">p2p / player / min</th><th class="num" data-k="5">Resolve</th><th class="num" data-k="6">Degenerate</th><th class="num" data-k="7">Zero-p2p</th><th data-k="8">Flags</th><th data-k="9">Sim</th><th data-k="10">JB</th><th data-k="11">MP</th><th data-k="12">Agreement</th></tr></thead>
<tbody>
{table_rows()}
</tbody></table></div>
<p class="legend"><b>Duration</b> at the best headcount, range 2→16 below it. <b>p2p/player/min</b> = player-to-player actions per player per minute at the best headcount (the forced-interaction score, normalised so 2- and 16-player rounds compare). <b>Zero-p2p</b> = share of antisocial rounds that completed with no player-to-player action, max over headcounts; the hard flag fires when it is ≥5% at the best headcount or at 4/8. <b>Degenerate</b> = ties with no tiebreak, stalemates/timeouts, runaway wins, flat outcomes, no-win-condition rounds. Rank score = interaction density (55%) + resolve (25%) + non-degenerate (20%); hard-flagged mechanics sink. Full numbers: <code>sim/RESULTS.md</code>, <code>sim/results.json</code>.</p>

<h3>The NPC quest loop — approach → lobby fill → game → resolution</h3>
<div class="measure"><p>One venue, one hour, Poisson arrivals (low ≈ 5/h, high ≈ 25/h). Agents walk up (~40 s), tap the NPC (85%), accept the quest (70%), and wait in the lobby with their own patience (~3 min ± 1) for the signature game's minimum headcount; 35% re-queue after a game. Dead air = time spent in an unfilled lobby or queue.</p></div>
<div class="tw"><table class="rv"><thead><tr><th>lane / density</th><th>game</th><th class="num">min</th><th class="num">arrivals/h</th><th class="num">games/h</th><th class="num">players served/h</th><th class="num">stuck lobbies/h</th><th class="num">gave up/h</th><th class="num">fill time</th><th class="num">dead air mean</th><th class="num">dead air p90</th><th class="num">avg size</th><th class="num">spectator share</th><th class="num">hours with 0 games</th></tr></thead><tbody>
{quest_rows()}
</tbody></table></div>
<div class="takeaways">
<p><b>Dead air and stuck states are structural at low density.</b> At ~5 arrivals an hour nothing but Split or Steal ever starts; Order Up (min 3) and Sheep Raid (min 4) see zero games in 93–100% of hours, and the people who do accept sit ~2.7 minutes before giving up. At ~25/h Order Up runs 2.7×/h and Sheep Raid still only 0.7×/h with 60% of hours empty. <b>Lobbies never resolve without help</b> — the NPC has to seed them (sit in as a player / bot-fill teams), lobbies should pool across the three venues, and the wait itself needs a 20–45-second game in it (Timebomb, Five Buttons, Last Tap).</p>
</div>
</section>

<section id="review">
<h2>2 · Expert design review</h2>
<div class="measure">
{md_to_html(review_md)}
</div>
</section>

<section id="brand">
<h2>3 · Logo and wordmark — first pass</h2>
<div class="measure"><p>Direction: one idea, no decoration. The icon is a solid silhouette cut from the <i>actual</i> 3.5-head player rig (<code>web/avatar3/body.glb</code>): every triangle orthographically projected, union-rasterised, contour-traced to a single SVG path — no illustration step, no Higgsfield needed (the direct cut was cleaner and exact). Bald base body in tank and shorts, arms at sides, so it is gender-neutral by construction. Wordmarks are written as SVG: outlined to paths via fontTools so they render identically everywhere, with a live-text twin beside each for editing. Black on transparent; no colour yet.</p></div>
<div class="brand">
  <h3 style="margin-top:0">Icon · silhouette from the rig</h3>
  <div class="marks">
    <div>{ICONS["front"]}<div class="cap">front · rando-silhouette-front.svg · recommended</div></div>
    <div>{ICONS["3q"]}<div class="cap">3/4 right · rando-silhouette-3q.svg</div></div>
    <div>{ICONS["3q-left"]}<div class="cap">3/4 left · rando-silhouette-3q-left.svg</div></div>
  </div>
  <div class="badges">
    <div class="b"><div class="sq" style="width:96px;height:96px">{ICONS["front"]}</div>96 · app icon</div>
    <div class="b"><div class="sq" style="width:48px;height:48px">{ICONS["front"]}</div>48</div>
    <div class="b"><div class="sq" style="width:32px;height:32px">{ICONS["front"]}</div>32 · badge</div>
    <div class="b"><div class="sq" style="width:16px;height:16px">{ICONS["front"]}</div>16 · favicon</div>
    <div class="b"><div class="sq" style="width:96px;height:96px">{ICONS["3q"]}</div>96 · 3/4</div>
    <div class="b"><div class="sq" style="width:32px;height:32px">{ICONS["3q"]}</div>32</div>
    <div class="b"><div class="sq" style="width:16px;height:16px">{ICONS["3q"]}</div>16</div>
  </div>
  <p class="why" style="margin-top:14px">The front view is the icon: symmetric, the ears give it the chibi signature, and at 16 px it still reads as a small person rather than a blob. The 3/4 views are for marketing/mascot moments where the figure needs a direction. The head is ~40% of the height — that ratio is the brand asset; don't crop it to a bust.</p>

  <h3 style="margin-top:30px">Wordmark · four single-typeface treatments</h3>
  {"".join(wm_blocks)}
  <p class="why" style="margin-top:18px"><b>Recommendation for the next pass:</b> take <b>B</b> (humanist semibold, Title case) as the primary direction — it is the quietest of the four, reads as a product name at app-store size and still holds at 16 px; under a real SF Pro / Helvetica Neue licence it becomes exactly the Ive-era look the brief names. Keep <b>A</b> alive as the "warm" alternative if the brand wants the icon's roundness echoed in the letterforms (but it needs a heavier weight below 24 px). <b>C</b> is the strongest small-size performer and the best fit for signage/venue moments; <b>D</b> is the most confident at badge size but drifts toward retail. All four pair with the icon in the lockups above without a divider — the icon's round head and the o's do the joining.</p>
</div>
</section>

<section id="files">
<h2>Files on the branch</h2>
<div class="measure">
<ul>
<li><code>sim/engine.py</code>, <code>sim/mechanics.py</code>, <code>sim/quest_loop.py</code>, <code>sim/run.py</code> — the harness; <code>py -3 sim/run.py</code> regenerates <code>sim/RESULTS.md</code> + <code>sim/results.json</code> in ~4 min.</li>
<li><code>design-review/mechanics-review.md</code> (the two persona reviews, architecture notes, recommendation), <code>verdicts.json</code>, <code>COMBINED.md</code> (the merged table), <code>build_combined.py</code>, <code>build_report.py</code> (this page).</li>
<li><code>brand/icon/</code> — silhouette SVGs + PNG previews + <code>tools/silhouette.py</code>; <code>brand/wordmark/</code> — A–D outlined + live SVGs, <code>sizes.png</code>, <code>tools/wordmark.py</code>.</li>
</ul>
</div>
</section>
</div>

<script>
(function () {{
  // filters
  var btns = document.querySelectorAll('.filters button');
  var rows = document.querySelectorAll('#rank tbody tr.row');
  btns.forEach(function (b) {{ b.addEventListener('click', function () {{
    btns.forEach(function (x) {{ x.classList.remove('on'); }});
    b.classList.add('on');
    var f = b.getAttribute('data-f');
    rows.forEach(function (r) {{
      if (f === 'all') {{ r.style.display = ''; return; }}
      var kv = f.split(':'); r.style.display = (r.getAttribute('data-' + kv[0]) === kv[1]) ? '' : 'none';
    }});
  }}); }});
  // sort by column
  var tbody = document.querySelector('#rank tbody');
  document.querySelectorAll('#rank thead th').forEach(function (th) {{
    th.addEventListener('click', function () {{
      var k = +th.getAttribute('data-k');
      var dir = th.getAttribute('data-dir') === 'asc' ? 'desc' : 'asc';
      th.setAttribute('data-dir', dir);
      var arr = Array.prototype.slice.call(tbody.querySelectorAll('tr.row'));
      arr.sort(function (a, b) {{
        var ta = a.children[k].textContent.trim(), tb = b.children[k].textContent.trim();
        var na = parseFloat(ta.replace(/[^0-9.\\-]/g, '')), nb = parseFloat(tb.replace(/[^0-9.\\-]/g, ''));
        var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : ta.localeCompare(tb);
        return dir === 'asc' ? cmp : -cmp;
      }});
      arr.forEach(function (r) {{ tbody.appendChild(r); }});
    }});
  }});
}})();
</script>
'''
out = os.path.join(OUT_DIR, "rando-mechanics-lab.html")
open(out, "w", encoding="utf-8").write(page)
print("wrote", out, f"({os.path.getsize(out)//1024} KB)")
