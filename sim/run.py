"""Sweep every mechanic x headcount x population, derive flags + verdicts,
write results.json and RESULTS.md.

    py -3 sim/run.py            (from the repo root; ~1-2 min)
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import HEADCOUNTS, make_agents, aggregate   # noqa: E402
from mechanics import ALL                                 # noqa: E402
import quest_loop                                         # noqa: E402

ROUNDS = 300
HERE = os.path.dirname(os.path.abspath(__file__))


def sweep(seed=1):
    out = {}
    for M in ALL:
        m = M()
        rec = {"family": m.family, "arch": m.arch, "lo": m.lo, "hi": m.hi, "target": m.target, "by_n": {}}
        for n in HEADCOUNTS:
            if not m.ok(n):
                rec["by_n"][str(n)] = None
                continue
            cell = {}
            for pop in ("mixed", "antisocial"):
                rng = random.Random(seed * 7919 + n * 31 + (1 if pop == "antisocial" else 0))
                rounds = [m.play(make_agents(n, rng, pop == "antisocial"), rng) for _ in range(ROUNDS)]
                cell[pop] = aggregate(rounds, n)
                notes = sorted({x for r in rounds for x in r.notes})
                if notes:
                    cell[pop]["notes"] = notes[:4]
            rec["by_n"][str(n)] = cell
        out[m.name] = rec
        print(f"  {m.name:36s} done", flush=True)
    return out


# mechanics where talking is not the medium (silence is not a weakness)
PHYSICAL = {"Sheep Raid", "Death Tag / Cops & Robbers", "Race / Manhunt-Tag", "Timebomb / Hot Potato",
            "Tile Wars", "Infection Zones", "Hide and Seek", "Team Challenge (2p coop physical)",
            "Accuracy / Long Jump", "Scavenger (planted object)"}
# winners are a whole side: top-skill baseline is ~50%, so the bar is higher
TEAM = {"Sheep Raid", "Tile Wars", "Rival Teams (generic)", "Team Challenge (2p coop physical)", "Split Clue"}
# "everyone but the imposter wins" makes top-skill-won meaningless
IMPOSTER = {"Liar Game / Mafia", "Guess the Number (timing imposter)", "Catch the Imposter"}


def derive(res):
    """Flags + mechanical verdict per mechanic from the sweep numbers."""
    for name, rec in res.items():
        cells = {int(n): c for n, c in rec["by_n"].items() if c}
        if name in IMPOSTER:
            for c in cells.values():
                for pop in c:
                    if isinstance(c[pop], dict):
                        c[pop]["top_skill_win_rate"] = None
        flags = []
        # best headcount by a composite of resolution, non-degeneracy, interaction density
        def comp(n):
            m = cells[n]["mixed"]
            return m["resolve_rate"] * 0.4 + (1 - m["degenerate_rate"]) * 0.3 + min(m["inter_ppm"], 8) / 8 * 0.3
        best_n = max(cells, key=comp)
        bm = cells[best_n]["mixed"]
        # HARD: can complete with zero p2p (antisocial pass) at the headcounts that matter:
        # the best n, and the core party sizes 4 and 8 where the rules allow them
        core = [n for n in {best_n, 4, 8} if n in cells]
        z = max(cells[n]["antisocial"]["zero_p2p_frac"] for n in core)
        zall = max(c["antisocial"]["zero_p2p_frac"] for c in cells.values())
        if z >= 0.05:
            flags.append("ZERO-INTERACTION")
        elif zall >= 0.05:
            flags.append(f"zero-interaction possible at {','.join(str(n) for n, c in cells.items() if c['antisocial']['zero_p2p_frac'] >= 0.05)}p")
        # soft: completes in silence (only meaningful where talk is the medium)
        zm = max(cells[n]["antisocial"]["zero_msg_frac"] for n in core)
        if zm >= 0.5 and "ZERO-INTERACTION" not in flags and name not in PHYSICAL:
            flags.append("silent-completable")
        if bm["resolve_rate"] < 0.9:
            flags.append(f"unresolved {int((1-bm['resolve_rate'])*100)}%")
        if bm["degenerate_rate"] >= 0.35:
            top = next(iter(bm["degenerate_breakdown"]), "")
            flags.append(f"degenerate {int(bm['degenerate_rate']*100)}% ({top})")
        # duration sanity (catalog should be short; > 10 min at <=8 players is long)
        long_ns = [n for n, c in cells.items() if n <= 8 and c["mixed"]["duration_mean_s"] > 600]
        if long_ns:
            flags.append(f"long at {','.join(map(str, long_ns))}p")
        # participation / sit-out
        low_part = [n for n, c in cells.items() if c["mixed"]["participation"] < 0.5]
        if low_part:
            flags.append(f"sit-out at {','.join(map(str, low_part))}p")
        low_active = [n for n, c in cells.items() if c["mixed"]["active_frac"] < 0.5]
        if low_active and not low_part:
            flags.append(f"low agency at {','.join(map(str, low_active))}p")
        # skill determinism (luck doesn't level the field)
        ts = [c["mixed"]["top_skill_win_rate"] for n, c in cells.items() if n >= 4 and c["mixed"]["top_skill_win_rate"] is not None]
        thr = 0.75 if name in TEAM else 0.6
        if ts and max(ts) >= thr:
            flags.append(f"skill-deterministic ({int(max(ts)*100)}% top-skill wins)")
        # two-player viability
        if 2 in cells and (cells[2]["mixed"]["resolve_rate"] < 0.5 or cells[2]["mixed"]["degenerate_rate"] > 0.9):
            flags.append("needs 3+")
        # verdict
        if "ZERO-INTERACTION" in flags:
            verdict = "cut"
        elif any(f.startswith(("unresolved", "degenerate")) for f in flags) or "silent-completable" in flags or any(f.startswith("long") for f in flags):
            verdict = "rework"
        else:
            verdict = "keep"
        # summary numbers (at best n)
        rec["best_n"] = best_n
        rec["summary"] = {
            "duration_s": bm["duration_mean_s"],
            "duration_range_s": [min(c["mixed"]["duration_mean_s"] for c in cells.values()),
                                 max(c["mixed"]["duration_mean_s"] for c in cells.values())],
            "inter_per_round": bm["inter_per_round"],
            "inter_ppm": bm["inter_ppm"],
            "inter_ppm_max": max(c["mixed"]["inter_ppm"] for c in cells.values()),
            "resolve": bm["resolve_rate"],
            "degenerate": bm["degenerate_rate"],
            "zero_p2p_antisocial_max": zall,
            "zero_p2p_antisocial_core": z,
            "zero_msg_antisocial_max": zm,
            "participation_min": min(c["mixed"]["participation"] for c in cells.values()),
            "active_min": min(c["mixed"]["active_frac"] for c in cells.values()),
        }
        rec["flags"] = flags
        rec["verdict"] = verdict
        # rank score: interaction density dominant, penalised by unresolved/degenerate; hard flag sinks
        s = rec["summary"]
        score = (min(s["inter_ppm_max"], 8.0) / 8.0) * 0.55 + s["resolve"] * 0.25 + (1 - s["degenerate"]) * 0.2
        if verdict == "cut":
            score -= 1.0
        rec["score"] = round(score, 3)
    return res


def fmt_dur(s):
    return f"{s/60:.1f} min" if s >= 90 else f"{int(round(s))} s"


def write_md(res, ql, path):
    ranked = sorted(res.items(), key=lambda kv: -kv[1]["score"])
    L = []
    L.append("# Rando mechanic simulation — results\n")
    L.append(f"{ROUNDS} rounds per mechanic per headcount per population (mixed / antisocial). "
             "Interaction = player-to-player actions only (msg / tap / prox); acting on the game itself never counts. "
             "`inter/pl/min` = p2p actions per player per minute at the mechanic's best headcount; "
             "`max` = best across headcounts. `zero-p2p` = share of ANTISOCIAL rounds that completed with no p2p action "
             "(≥5% ⇒ hard flag).\n")
    L.append("## Ranked table\n")
    L.append("| # | Mechanic | Tier | Best n | Duration (best n) | Range 2→16 | inter/round | inter/pl/min | max | Resolve | Degenerate | zero-p2p | Flags | Sim verdict |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for i, (name, r) in enumerate(ranked, 1):
        s = r["summary"]
        L.append(f"| {i} | **{name}** | {r['family']} | {r['best_n']} | {fmt_dur(s['duration_s'])} | "
                 f"{fmt_dur(s['duration_range_s'][0])}–{fmt_dur(s['duration_range_s'][1])} | {s['inter_per_round']} | "
                 f"{s['inter_ppm']} | {s['inter_ppm_max']} | {int(s['resolve']*100)}% | {int(s['degenerate']*100)}% | "
                 f"{int(s['zero_p2p_antisocial_max']*100)}% | {'; '.join(r['flags']) or '—'} | **{r['verdict']}** |")
    L.append("\n## Per-headcount detail\n")
    for name, r in ranked:
        L.append(f"### {name}  ·  {r['family']} / {r['arch']}  ·  rules allow {r['lo']}–{r['hi']}  ·  target {r['target']}\n")
        L.append("| n | pop | duration | p90 | resolve | degenerate (top) | msg | tap | prox | inter/pl/min | zero-p2p | zero-msg | particip. | agency | top-skill wins |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for n in HEADCOUNTS:
            c = r["by_n"].get(str(n))
            if not c:
                L.append(f"| {n} | — | n/a | | | | | | | | | | | | |")
                continue
            for pop in ("mixed", "antisocial"):
                a = c[pop]
                top = next(iter(a["degenerate_breakdown"].items()), None)
                topS = f"{int(a['degenerate_rate']*100)}%" + (f" ({top[0]} {int(top[1]*100)}%)" if top else "")
                ts = "—" if a["top_skill_win_rate"] is None else f"{int(a['top_skill_win_rate']*100)}%"
                L.append(f"| {n} | {pop} | {fmt_dur(a['duration_mean_s'])} | {fmt_dur(a['duration_p90_s'])} | {int(a['resolve_rate']*100)}% | {topS} | "
                         f"{a['inter_msg']} | {a['inter_tap']} | {a['inter_prox']} | {a['inter_ppm']} | {int(a['zero_p2p_frac']*100)}% | "
                         f"{int(a['zero_msg_frac']*100)}% | {int(a['participation']*100)}% | {int(a['active_frac']*100)}% | {ts} |")
        notes = sorted({x for n in HEADCOUNTS for c in [r["by_n"].get(str(n))] if c for x in c["mixed"].get("notes", [])})
        if notes:
            L.append(f"\nnotes: {'; '.join(notes)}")
        L.append("")
    L.append("## NPC quest loop (approach → lobby fill → game → resolution)\n")
    L.append("| archetype / density | game | min | arrivals/h | games/h | players served/h | stuck lobbies/h | declined/h | abandoned/h | fill time | dead air mean | dead air p90 | avg size | spectator share | hours with 0 games |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for k, q in ql.items():
        L.append(f"| {k} | {q['game']} | {q['min_players']} | {q['arrivals_per_hour']} | {q['games_per_hour']} | {q['players_served_per_hour']} | "
                 f"{q['stuck_lobbies_per_hour']} | {q['declined_per_hour']} | {q['abandoned_per_hour']} | "
                 f"{fmt_dur(q['fill_time_mean_s']) if q['fill_time_mean_s'] is not None else '—'} | {fmt_dur(q['dead_air_mean_s'])} | {fmt_dur(q['dead_air_p90_s'])} | "
                 f"{q['avg_game_size'] or '—'} | {q['spectator_share'] if q['spectator_share'] is not None else '—'} | {int(q['no_game_hours_frac']*100)}% |")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    print("sweeping mechanics…", flush=True)
    res = derive(sweep())
    print("quest loop…", flush=True)
    ql = quest_loop.run()
    json.dump({"mechanics": res, "quest_loop": ql, "rounds": ROUNDS},
              open(os.path.join(HERE, "results.json"), "w"), indent=1)
    write_md(res, ql, os.path.join(HERE, "RESULTS.md"))
    print("wrote sim/results.json + sim/RESULTS.md")
