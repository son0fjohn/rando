"""NPC quest loop: approach -> lobby fill -> game -> resolution.

Discrete-time sim (1 s ticks) over a 60-minute window at ONE venue. Agents
arrive by a Poisson process (density), walk up (~40 s), tap the NPC, accept
the quest with some probability, and wait in the lobby until it reaches the
signature game's minimum headcount — or the lobby times out. After a game,
some players re-queue. Logs dead air (time sat in an unfilled lobby or a
queue), stuck lobbies (timed out below minimum), fill times, games per hour,
players served, and the spectator-only share for Split or Steal.
"""
import random
import statistics

SIGNATURE = {
    "chill":  {"game": "Order Up",       "min": 3, "max": 8,  "dur": 210.0, "active": None},
    "chaos":  {"game": "Split or Steal", "min": 2, "max": 16, "dur": 42.0,  "active": 2},
    "sporty": {"game": "Sheep Raid",     "min": 4, "max": 8,  "dur": 360.0, "active": None},
}
DENSITY = {"low": 2.5, "high": 12.0}   # expected arrivals per 30 min
PATIENCE_MEAN, PATIENCE_SD = 180.0, 60.0   # per-agent: how long they'll sit in an unfilled lobby
COUNTDOWN = 20.0                      # grace after min reached so stragglers can join
QUEUE_PATIENCE = 240.0
P_TAP, P_ACCEPT, P_REPLAY = 0.85, 0.7, 0.35
APPROACH_S = 40.0


def simulate(arch, density, rng, T=3600.0):
    cfg = SIGNATURE[arch]
    lam = DENSITY[density] / 1800.0
    pending = []
    t = 0.0
    while True:
        t += rng.expovariate(lam)
        if t > T:
            break
        pending.append(t)
    n_arr = len(pending)

    agents = []
    lobby = []
    lobby_open_t = None
    min_reached_t = None
    game_until = None
    game_members = []
    games, stuck, declined, abandoned = 0, 0, 0, 0
    dead_air, fill_times, sizes, spectators = [], [], [], []
    lobby_had_people = False

    def open_lobby(a, now):
        nonlocal lobby_open_t, lobby_had_people
        a["state"], a["t_state"] = "lobby", now
        a.setdefault("patience", max(45.0, rng.gauss(PATIENCE_MEAN, PATIENCE_SD)))
        lobby.append(a)
        lobby_had_people = True
        if lobby_open_t is None:
            lobby_open_t = now

    t = 0.0
    while t < T + 900:
        t += 1.0
        while pending and pending[0] <= t:
            pending.pop(0)
            agents.append({"state": "approach", "t_state": t, "waited": 0.0})
        for a in agents:
            if a["state"] == "approach" and t - a["t_state"] >= APPROACH_S:
                if rng.random() < P_TAP and rng.random() < P_ACCEPT:
                    if game_until is not None:
                        a["state"], a["t_state"] = "queue", t
                    else:
                        open_lobby(a, t)
                else:
                    a["state"] = "gone"
                    declined += 1
            elif a["state"] == "queue":
                a["waited"] += 1.0
                if game_until is None:
                    open_lobby(a, t)
                elif t - a["t_state"] > QUEUE_PATIENCE:
                    a["state"] = "gone"
                    abandoned += 1
                    dead_air.append(a["waited"])
        # lobby
        if game_until is None and lobby:
            if len(lobby) < cfg["min"]:
                min_reached_t = None
                for a in list(lobby):
                    a["waited"] += 1.0
                    if t - a["t_state"] > a["patience"]:   # gives up individually
                        lobby.remove(a)
                        a["state"] = "gone"
                        abandoned += 1
                        dead_air.append(a["waited"])
                if not lobby:
                    stuck += 1            # a lobby that opened and dwindled to nothing
                    lobby_open_t = None
            else:
                if min_reached_t is None:
                    min_reached_t = t
                if len(lobby) >= cfg["max"] or t - min_reached_t >= COUNTDOWN:
                    members, overflow = lobby[:cfg["max"]], lobby[cfg["max"]:]
                    for a in members:
                        a["state"] = "playing"
                    fill_times.append(t - members[0]["t_state"])
                    sizes.append(len(members))
                    if cfg["active"]:
                        spectators.append(max(0, len(members) - cfg["active"]) / len(members))
                    game_members = members
                    game_until = t + cfg["dur"]
                    games += 1
                    lobby = overflow
                    lobby_open_t = t if overflow else None
                    min_reached_t = None
        # game ends
        if game_until is not None and t >= game_until:
            game_until = None
            for a in game_members:
                dead_air.append(a["waited"])
                if rng.random() < P_REPLAY:
                    a["waited"] = 0.0
                    open_lobby(a, t)
                else:
                    a["state"] = "gone"
            game_members = []
        if t > T and not lobby and game_until is None and not pending \
                and not any(a["state"] in ("approach", "queue") for a in agents):
            break
    for a in lobby:  # still waiting at the end
        dead_air.append(a["waited"])
    if lobby and len(lobby) < cfg["min"]:
        stuck += 1
    return {
        "arrivals": n_arr, "games": games, "players_served": sum(sizes),
        "stuck": stuck, "declined": declined, "abandoned": abandoned,
        "fill": statistics.fmean(fill_times) if fill_times else None,
        "dead_mean": statistics.fmean(dead_air) if dead_air else 0.0,
        "dead_p90": sorted(dead_air)[int(0.9 * (len(dead_air) - 1))] if dead_air else 0.0,
        "size": statistics.fmean(sizes) if sizes else None,
        "spec": statistics.fmean(spectators) if spectators else None,
    }


def _mean(vals):
    vals = [v for v in vals if v is not None]
    return round(statistics.fmean(vals), 1) if vals else None


def run(seed=7, reps=60):
    out = {}
    for arch, cfg in SIGNATURE.items():
        for density in DENSITY:
            rs = [simulate(arch, density, random.Random(seed * 100 + r)) for r in range(reps)]
            out[f"{arch}/{density}"] = {
                "arch": arch, "game": cfg["game"], "density": density,
                "min_players": cfg["min"],
                "arrivals_per_hour": _mean([x["arrivals"] for x in rs]),
                "games_per_hour": round(statistics.fmean(x["games"] for x in rs), 2),
                "players_served_per_hour": _mean([x["players_served"] for x in rs]),
                "stuck_lobbies_per_hour": round(statistics.fmean(x["stuck"] for x in rs), 2),
                "declined_per_hour": _mean([x["declined"] for x in rs]),
                "abandoned_per_hour": _mean([x["abandoned"] for x in rs]),
                "fill_time_mean_s": _mean([x["fill"] for x in rs]),
                "dead_air_mean_s": _mean([x["dead_mean"] for x in rs]),
                "dead_air_p90_s": _mean([x["dead_p90"] for x in rs]),
                "avg_game_size": _mean([x["size"] for x in rs]),
                "spectator_share": round(statistics.fmean(x["spec"] for x in rs if x["spec"] is not None), 2)
                    if any(x["spec"] is not None for x in rs) else None,
                "no_game_hours_frac": round(sum(1 for x in rs if x["games"] == 0) / reps, 2),
            }
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=1))
