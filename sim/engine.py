"""Rando mechanic simulator — core engine.

Rule-based agents with traits stand in for real players. Each mechanic
simulates ONE round and returns a Round. The sweep runs every mechanic at
2/4/8/16 players (where its rules allow) across many rounds and TWO agent
populations:

  mixed       — realistic spread of sociability/skill/speed
  antisocial  — sociability forced to 0: nobody says anything optional.
                If a mechanic still completes rounds with zero
                player-to-player actions here, it CAN complete with zero
                interaction -> hard flag (the "puzzle, not people" rule).

Interaction taxonomy (player-to-player actions only; acting on the game
itself — tapping a boss, pressing a button, answering trivia — does NOT
count):
  msg  : a verbal/chat act directed at another player or the group
         (describing, negotiating, shouting a guess, answering a dare)
  tap  : a targeting action on a specific other player (vote, guess-who,
         tag-toss decision, split/steal choice aimed at a partner)
  prox : a physical co-location event (tag, contest for an object, raid,
         shared zone, collision)
"""
import math
import random
import statistics
from dataclasses import dataclass, field

HEADCOUNTS = [2, 4, 8, 16]


# ---------------------------------------------------------------- agents
@dataclass
class Agent:
    id: int
    skill: float    # 0..1 general competence (knowledge, aim, drawing)
    social: float   # 0..1 propensity for OPTIONAL talk/reactions
    speed: float    # m/s sprint-ish pace for physical games
    bluff: float    # 0..1 lying/blending ability
    greed: float    # 0..1 steal/raid appetite
    react: float    # base reaction seconds
    team: int = 0
    # per-round scratch
    pos: tuple = (0.0, 0.0)
    alive: bool = True
    acted: bool = False
    active_time: float = 0.0


def make_agents(n, rng, antisocial=False):
    out = []
    for i in range(n):
        out.append(Agent(
            id=i,
            skill=clamp(rng.gauss(0.5, 0.2), 0.05, 0.95),
            social=0.0 if antisocial else clamp(rng.gauss(0.55, 0.25), 0.0, 1.0),
            speed=clamp(rng.gauss(2.4, 0.45), 1.4, 3.4),
            bluff=clamp(rng.gauss(0.5, 0.22), 0.05, 0.95),
            greed=clamp(rng.gauss(0.45, 0.25), 0.0, 1.0),
            react=clamp(rng.gauss(1.1, 0.35), 0.4, 2.5),
        ))
    return out


# ---------------------------------------------------------------- results
@dataclass
class Inter:
    msg: int = 0
    tap: int = 0
    prox: int = 0

    def total(self):
        return self.msg + self.tap + self.prox


@dataclass
class Round:
    duration: float               # seconds
    resolved: bool                # a win/loss/coop-complete state was reached
    degenerate: str | None        # reason tag or None
    inter: Inter
    active_frac: float            # mean fraction of player-time WITH agency
    acted: int                    # players who took >= 1 action of any kind
    top_skill_won: bool | None    # did the highest-skill agent win (None if n/a)
    notes: list = field(default_factory=list)


# ---------------------------------------------------------------- helpers
def clamp(x, a, b):
    return max(a, min(b, x))


def poisson(rng, lam):
    if lam <= 0:
        return 0
    L = math.exp(-lam)
    k, p = 0, 1.0
    while True:
        p *= rng.random()
        if p < L:
            return k
        k += 1
        if k > 400:
            return k


def chatter(agents, rng, window_s, rate_per_min=1.5):
    """Optional talk: sum over agents of poisson(social * rate * window)."""
    return sum(poisson(rng, a.social * rate_per_min * window_s / 60.0) for a in agents)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def step_toward(pos, target, speed, dt, bounds):
    d = dist(pos, target)
    if d < 1e-6:
        return pos
    k = min(1.0, speed * dt / d)
    x = pos[0] + (target[0] - pos[0]) * k
    y = pos[1] + (target[1] - pos[1]) * k
    return (clamp(x, 0.0, bounds[0]), clamp(y, 0.0, bounds[1]))


def flee_from(pos, threat, speed, dt, bounds, rng, jitter=0.55):
    dx, dy = pos[0] - threat[0], pos[1] - threat[1]
    ang = math.atan2(dy, dx) + rng.gauss(0, jitter)
    # mild center pull so runners don't pin themselves in corners forever
    cx, cy = bounds[0] / 2, bounds[1] / 2
    ang_c = math.atan2(cy - pos[1], cx - pos[0])
    near_wall = min(pos[0], bounds[0] - pos[0], pos[1], bounds[1] - pos[1]) < 2.5
    if near_wall:
        ang = 0.55 * ang + 0.45 * ang_c
    x = clamp(pos[0] + math.cos(ang) * speed * dt, 0.0, bounds[0])
    y = clamp(pos[1] + math.sin(ang) * speed * dt, 0.0, bounds[1])
    return (x, y)


def rand_pos(rng, bounds):
    return (rng.uniform(0, bounds[0]), rng.uniform(0, bounds[1]))


def winner_is_top_skill(agents, winner_ids):
    if not winner_ids:
        return None
    top = max(agents, key=lambda a: a.skill).id
    return top in set(winner_ids)


def unique_max(scores):
    """Return (winner_ids, tied) for a dict id->score."""
    if not scores:
        return [], False
    best = max(scores.values())
    ws = [k for k, v in scores.items() if v == best]
    return ws, len(ws) > 1


# ---------------------------------------------------------------- aggregate
def aggregate(rounds, n):
    durs = [r.duration for r in rounds]
    tot = [r.inter.total() for r in rounds]
    msg = [r.inter.msg for r in rounds]
    tap = [r.inter.tap for r in rounds]
    prox = [r.inter.prox for r in rounds]
    degen = {}
    for r in rounds:
        if r.degenerate:
            degen[r.degenerate] = degen.get(r.degenerate, 0) + 1
    k = len(rounds)
    mean_dur = statistics.fmean(durs)
    ts = [r.top_skill_won for r in rounds if r.top_skill_won is not None]
    return {
        "rounds": k,
        "duration_mean_s": round(mean_dur, 1),
        "duration_p90_s": round(sorted(durs)[int(0.9 * (k - 1))], 1),
        "resolve_rate": round(sum(r.resolved for r in rounds) / k, 3),
        "degenerate_rate": round(sum(1 for r in rounds if r.degenerate) / k, 3),
        "degenerate_breakdown": {d: round(c / k, 3) for d, c in sorted(degen.items(), key=lambda x: -x[1])},
        "inter_per_round": round(statistics.fmean(tot), 1),
        "inter_msg": round(statistics.fmean(msg), 1),
        "inter_tap": round(statistics.fmean(tap), 1),
        "inter_prox": round(statistics.fmean(prox), 1),
        # player-to-player actions per player per minute (density, comparable across sizes)
        "inter_ppm": round(statistics.fmean(tot) / max(1e-6, n * mean_dur / 60.0), 2),
        "zero_p2p_frac": round(sum(1 for t in tot if t == 0) / k, 3),
        "zero_msg_frac": round(sum(1 for m in msg if m == 0) / k, 3),
        "active_frac": round(statistics.fmean(r.active_frac for r in rounds), 3),
        "participation": round(statistics.fmean(r.acted / n for r in rounds), 3),
        "top_skill_win_rate": round(sum(ts) / len(ts), 3) if ts else None,
    }
