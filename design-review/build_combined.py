"""Merge sim/results.json with design-review/verdicts.json -> COMBINED.md
(and combined.json used by the report page).

    py -3 design-review/build_combined.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sim = json.load(open(os.path.join(ROOT, "sim", "results.json"), encoding="utf-8"))
ver = json.load(open(os.path.join(HERE, "verdicts.json"), encoding="utf-8"))
mech = sim["mechanics"]


def fmt_dur(s):
    return f"{s/60:.1f} min" if s >= 90 else f"{int(round(s))} s"


def agreement(sim_v, jb, mp):
    s = {"keep": "keep", "rework": "tweak", "cut": "cut"}[sim_v]
    votes = [s, jb, mp]
    if votes.count(s) == 3:
        return "all agree"
    if jb == mp and jb != s:
        return f"designers both say {jb}, sim says {s}"
    if jb == s and mp != s:
        return f"sim + JB {s}, MP {mp}"
    if mp == s and jb != s:
        return f"sim + MP {s}, JB {jb}"
    return "three-way split"


rows = []
for name, r in sorted(mech.items(), key=lambda kv: -kv[1]["score"]):
    v = ver.get(name, {})
    s = r["summary"]
    rows.append({
        "mechanic": name, "family": r["family"], "arch": r["arch"],
        "best_n": r["best_n"], "duration_s": s["duration_s"],
        "duration_range_s": s["duration_range_s"],
        "inter_per_round": s["inter_per_round"], "inter_ppm": s["inter_ppm"], "inter_ppm_max": s["inter_ppm_max"],
        "resolve": s["resolve"], "degenerate": s["degenerate"], "zero_p2p": s["zero_p2p_antisocial_max"],
        "flags": r["flags"], "sim_verdict": r["verdict"], "score": r["score"],
        "jb": v.get("jb", "—"), "jb_note": v.get("jb_note", ""),
        "mp": v.get("mp", "—"), "mp_note": v.get("mp_note", ""),
        "agreement": agreement(r["verdict"], v.get("jb", "—"), v.get("mp", "—")),
    })

json.dump({"rows": rows, "quest_loop": sim["quest_loop"], "rounds": sim["rounds"]},
          open(os.path.join(HERE, "combined.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

L = ["# Rando mechanics — combined ranking (simulation × design review)\n",
     "Sim columns are from `sim/RESULTS.md` (best headcount). Design review columns are the two persona verdicts "
     "from `verdicts.json` (JB = Jackbox-style, MP = Mario Party-style). The sim verdict is mechanical: "
     "ZERO-INTERACTION ⇒ cut; unresolved/degenerate/silent/long ⇒ rework; else keep.\n",
     "| # | Mechanic | Tier / lane | Best n | Duration | p2p / player / min | Resolve | Degenerate | Flags | **Sim** | **JB** | **MP** | Agreement |",
     "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
for i, r in enumerate(rows, 1):
    L.append(f"| {i} | **{r['mechanic']}** | {r['family']} / {r['arch']} | {r['best_n']} | {fmt_dur(r['duration_s'])} | "
             f"{r['inter_ppm']} | {int(r['resolve']*100)}% | {int(r['degenerate']*100)}% | {'; '.join(r['flags']) or '—'} | "
             f"**{r['sim_verdict']}** | {r['jb']} | {r['mp']} | {r['agreement']} |")
L.append("\n## Persona notes per mechanic\n")
for r in rows:
    L.append(f"**{r['mechanic']}** — JB ({r['jb']}): {r['jb_note']}  \nMP ({r['mp']}): {r['mp_note']}\n")
open(os.path.join(HERE, "COMBINED.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("wrote COMBINED.md + combined.json;", len(rows), "rows")
from collections import Counter
print(Counter(r["agreement"].split(",")[0] for r in rows))
