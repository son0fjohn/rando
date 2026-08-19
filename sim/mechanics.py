"""All Rando mechanics as simulation models. One class per mechanic.

Each model is deliberately simple and honest about what the RULES force:
anything optional (banter, advice-shouting, cheering) is gated by the
agent's `social` trait so the antisocial population reveals whether the
mechanic's interaction is structural or incidental.
"""
import math
from engine import (Inter, Round, clamp, poisson, chatter, dist, step_toward,
                    flee_from, rand_pos, winner_is_top_skill, unique_max)


class Mechanic:
    name = ""
    family = ""      # signature | catalog | unshaped | superseded
    arch = ""        # chill | chaos | sporty | any
    lo, hi = 2, 16
    target = ""      # intended duration band text

    def ok(self, n):
        return self.lo <= n <= self.hi

    def play(self, agents, rng):
        raise NotImplementedError


# ====================================================================
# NPC SIGNATURE GAMES
# ====================================================================
class OrderUp(Mechanic):
    name, family, arch, lo, hi = "Order Up", "signature", "chill", 2, 16
    target = "3-5 min"

    def play(self, ag, rng):
        n = len(ag)
        menu = 6
        inter = Inter()
        weights = [rng.uniform(0.5, 1.5) for _ in range(menu)]
        picks = [rng.choices(range(menu), weights)[0] for _ in ag]
        t = 20.0
        # conversation window (the game's heart; NOT enforced — agents may sit silent)
        win = 90.0 if n <= 4 else 120.0
        msgs = chatter(ag, rng, win, rate_per_min=2.2)
        inter.msg += msgs
        t += win
        info = clamp(msgs / (n * 2.5), 0, 1)
        t += 25 + 1.5 * n
        scores = {}
        distinct = len(set(picks))
        for a in ag:
            a.acted = True
            correct = 0
            for b in ag:
                if b is a:
                    continue
                inter.tap += 1  # a guess aimed at a specific other player
                base = 1.0 / max(1, distinct)
                p = base + (1 - base) * clamp(0.25 * a.skill + 0.6 * info, 0, 1)
                if n == 2:
                    p = 1.0  # only one other player: trivially deducible
                if rng.random() < p:
                    correct += 1
            scores[a.id] = correct
        t += 15
        ws, tied = unique_max(scores)
        degen = None
        if n == 2:
            degen = "trivial_2p"
        elif tied:
            degen = "tie_no_tiebreak"
        return Round(t, not tied, degen, inter, 1.0, n, winner_is_top_skill(ag, ws))


class SplitOrSteal(Mechanic):
    name, family, arch, lo, hi = "Split or Steal", "signature", "chaos", 2, 16
    target = "45 s / pair"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        a, b = ag[0], ag[1]
        a.acted = b.acted = True
        ma = poisson(rng, a.social * 3.0)   # 30 s negotiation — encouraged, not forced
        mb = poisson(rng, b.social * 3.0)
        inter.msg += ma + mb
        promised = (ma >= 2 and mb >= 2)
        aud = ag[2:]
        inter.msg += chatter(aud, rng, 30, rate_per_min=1.6)  # heckling/advice, optional
        for x in aud:
            if rng.random() < x.social * 0.6:
                x.acted = True
        inter.tap += 2  # the choice itself is aimed at the partner

        def p_steal(x):
            return clamp(0.15 + 0.6 * x.greed - (0.18 if promised else 0.0), 0.03, 0.95)
        sa = rng.random() < p_steal(a)
        sb = rng.random() < p_steal(b)
        t = 30 + 12
        if not sa and not sb:
            degen, ws = "both_split_no_prize", [a.id, b.id]
        elif sa and sb:
            degen, ws = "both_steal_both_out", []
        else:
            degen, ws = None, ([a.id] if sa else [b.id])
        acted = sum(1 for x in ag if x.acted)
        notes = [f"tournament of {n//2} pairs ~ {int(n//2*42)} s"] if n > 2 else []
        return Round(t, True, degen, inter, 2.0 / n, acted, winner_is_top_skill(ag, ws), notes)


class SheepRaid(Mechanic):
    name, family, arch, lo, hi = "Sheep Raid", "signature", "sporty", 4, 8
    target = "5-8 min fixed"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        W, H = 30.0, 20.0
        T, dt = 360.0, 0.5
        pens = {0: (2.0, H / 2), 1: (W - 2.0, H / 2)}
        pen = {0: 0, 1: 0}
        half = n // 2
        for i, a in enumerate(ag):
            a.team = 0 if i < half else 1
            a.pos = (pens[a.team][0] + rng.uniform(-1, 1), pens[a.team][1] + rng.uniform(-3, 3))
            a.acted = True
        sheep = [(W / 2 + rng.uniform(-4, 4), H / 2 + rng.uniform(-4, 4)) for _ in range(2)]
        carrying = {a.id: False for a in ag}
        raiding = {a.id: False for a in ag}
        t = spawn_clock = 0.0
        half_margin = None
        contested = set()
        last_contact = {}
        while t < T:
            t += dt
            spawn_clock += dt
            if spawn_clock >= 8.0:
                spawn_clock = 0.0
                sheep.append((W / 2 + rng.uniform(-5, 5), H / 2 + rng.uniform(-5, 5)))
            contested.clear()
            for a in ag:
                own, enemy = pens[a.team], pens[1 - a.team]
                if carrying[a.id]:
                    a.pos = step_toward(a.pos, own, a.speed * 0.85, dt, (W, H))
                    if dist(a.pos, own) < 1.5:
                        carrying[a.id] = False
                        pen[a.team] += 1
                    continue
                behind = pen[1 - a.team] > pen[a.team]
                if (not raiding[a.id] and pen[1 - a.team] >= 2 and (behind or a.greed > 0.7)
                        and rng.random() < a.greed * 0.05):
                    raiding[a.id] = True
                if raiding[a.id]:
                    a.pos = step_toward(a.pos, enemy, a.speed, dt, (W, H))
                    if dist(a.pos, enemy) < 1.5:
                        raiding[a.id] = False
                        defenders = [d for d in ag if d.team != a.team and dist(d.pos, enemy) < 2.5]
                        inter.prox += 1  # raid event at the enemy pen
                        if defenders and rng.random() < 0.55:
                            pass  # blocked by a defender
                        elif pen[1 - a.team] > 0:
                            pen[1 - a.team] -= 1
                            carrying[a.id] = True
                    continue
                if not sheep:
                    continue
                target = min(sheep, key=lambda s: dist(a.pos, s))
                a.pos = step_toward(a.pos, target, a.speed, dt, (W, H))
                if dist(a.pos, target) < 1.2:
                    rivals = [o for o in ag if o is not a and o.team != a.team and dist(o.pos, target) < 2.0]
                    if rivals:
                        key = (round(target[0], 1), round(target[1], 1))
                        if key not in contested:
                            inter.prox += 1
                            contested.add(key)
                        fastest = max([a] + rivals, key=lambda o: o.speed + rng.uniform(0, 0.5))
                        if fastest is not a:
                            continue
                    if target in sheep:
                        sheep.remove(target)
                        carrying[a.id] = True
            # physical presence: opponents brushing past within 1.5 m, once per pair per 6 s
            for i in range(n):
                for j in range(i + 1, n):
                    if ag[i].team != ag[j].team and dist(ag[i].pos, ag[j].pos) < 1.5:
                        if t - last_contact.get((i, j), -99) >= 6.0:
                            last_contact[(i, j)] = t
                            inter.prox += 1
            if half_margin is None and t >= T / 2:
                tot = pen[0] + pen[1]
                half_margin = (abs(pen[0] - pen[1]) / tot) if tot else 0.0
        degen = None
        if pen[0] == pen[1]:
            degen = "tie"
        elif half_margin is not None and half_margin > 0.6:
            degen = "runaway"
        win_team = 0 if pen[0] > pen[1] else 1
        ws = [a.id for a in ag if a.team == win_team] if pen[0] != pen[1] else []
        return Round(T, True, degen, inter, 1.0, n, winner_is_top_skill(ag, ws), [f"final {pen[0]}-{pen[1]}"])


# ====================================================================
# CATALOG GAMES
# ====================================================================
class TriviaStandard(Mechanic):
    name, family, arch, lo, hi = "Trivia (first to 3)", "catalog", "any", 2, 16
    target = "1-3 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        score = {a.id: 0 for a in ag}
        t, q, winner = 0.0, 0, None
        while q < 12 and winner is None:
            q += 1
            d = rng.uniform(0.3, 0.85)
            t += 15
            for a in ag:
                a.acted = True
                p = clamp(0.2 + 0.7 * a.skill - 0.45 * d + rng.gauss(0, 0.08), 0.02, 0.98)
                if rng.random() < p:
                    score[a.id] += 1
            inter.msg += chatter(ag, rng, 15, rate_per_min=1.0)
            tops = [i for i, s in score.items() if s >= 3]
            if len(tops) == 1:
                winner = tops[0]
            elif len(tops) > 1:
                while t < 240:  # sudden-death tiebreaks
                    t += 15
                    ok = [i for i in tops if rng.random() < clamp(0.2 + 0.7 * ag[i].skill - 0.3, 0.05, 0.95)]
                    if len(ok) == 1:
                        winner = ok[0]
                        break
                    if len(ok) > 1:
                        tops = ok
                break
        resolved = winner is not None
        degen = None
        if not resolved:
            degen = "timeout"
        elif max(s for i, s in score.items() if i != winner) == 0:
            degen = "runaway_3_0"
        return Round(t, resolved, degen, inter, 1.0, n, winner_is_top_skill(ag, [winner] if resolved else []))


class MajorityRules(Mechanic):
    name, family, arch, lo, hi = "Trivia: Majority Rules", "catalog", "any", 2, 16
    target = "1-3 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        score = {a.id: 0 for a in ag}
        t, q, winner, splits = 0.0, 0, None, 0
        while q < 12 and winner is None:
            q += 1
            t += 18
            bias = rng.uniform(0.35, 0.65)
            yes = sum(rng.random() < bias for _ in ag)
            if yes * 2 == n:
                splits += 1
                inter.msg += chatter(ag, rng, 18, 1.0)
                continue
            maj = yes * 2 > n
            for a in ag:
                a.acted = True
                p = clamp(0.5 + 0.3 * a.skill + 0.1 * a.social, 0.3, 0.95)
                guess = maj if rng.random() < p else (not maj)
                if guess == maj:
                    score[a.id] += 1
            inter.msg += chatter(ag, rng, 18, 1.4)
            tops = [i for i, s in score.items() if s >= 3]
            if len(tops) == 1:
                winner = tops[0]
            elif len(tops) > 1:
                break
        resolved = winner is not None
        degen = None
        if n == 2:
            degen, resolved = "no_majority_2p", False
        elif not resolved:
            degen = "tie_or_timeout"
        elif splits >= 2:
            degen = "frequent_even_splits"
        return Round(t, resolved, degen, inter, 1.0, n, winner_is_top_skill(ag, [winner] if resolved else []))


class HigherLower(Mechanic):
    name, family, arch, lo, hi = "Trivia: Higher or Lower", "catalog", "any", 2, 16
    target = "1-2 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        score = {a.id: 0 for a in ag}
        t, q, winner = 0.0, 0, None
        while q < 14 and winner is None:
            q += 1
            t += 12
            d = rng.uniform(0.2, 0.8)
            for a in ag:
                a.acted = True
                if rng.random() < clamp(0.5 + 0.35 * a.skill - 0.25 * d, 0.3, 0.95):
                    score[a.id] += 1
            inter.msg += chatter(ag, rng, 12, 1.0)
            tops = [i for i, s in score.items() if s >= 3]
            if len(tops) == 1:
                winner = tops[0]
            elif len(tops) > 1:
                break
        resolved = winner is not None
        return Round(t, resolved, None if resolved else "simultaneous_finish_tie", inter, 1.0, n,
                     winner_is_top_skill(ag, [winner] if resolved else []))


class DrawMyThing(Mechanic):
    name, family, arch, lo, hi = "Draw My Thing", "catalog", "any", 2, 16
    target = "per-drawer 60 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        score = {a.id: 0 for a in ag}
        t, duds = 0.0, 0
        for drawer in ag:
            drawer.acted = True
            t += 20
            solved = False
            for _ in range(10):  # 6 s guess ticks, 60 s window
                t += 6
                for g in ag:
                    if g is drawer:
                        continue
                    if rng.random() < 0.75:  # a guess fired at the drawer
                        inter.msg += 1
                        g.acted = True
                        if rng.random() < clamp(0.05 + 0.22 * drawer.skill + 0.12 * g.skill, 0.02, 0.6):
                            score[g.id] += 2
                            score[drawer.id] += 1
                            solved = True
                            break
                if solved:
                    break
            if not solved:
                duds += 1
            t += 4
        ws, tied = unique_max(score)
        degen = None
        if duds / n > 0.5:
            degen = "mostly_dud_rounds"
        elif tied:
            degen = "tie"
        return Round(t, not tied, degen, inter, 1.0, n, winner_is_top_skill(ag, ws), ["long at 16"] if n >= 16 else [])


class CaptionThis(Mechanic):
    name, family, arch, lo, hi = "Caption This (제목 짓기)", "catalog", "any", 2, 16
    target = "~90 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        t = 45.0
        quality = {a.id: clamp(a.skill + rng.gauss(0, 0.25), 0, 1.5) for a in ag}
        votes = {a.id: 0 for a in ag}
        for a in ag:
            a.acted = True
            others = [b for b in ag if b is not a]
            pick = rng.choices(others, [quality[b.id] + 0.05 for b in others])[0]
            votes[pick.id] += 1
            inter.tap += 1
        t += 20 + 2 * n
        inter.msg += chatter(ag, rng, 25, 2.0)
        ws, tied = unique_max(votes)
        degen = "always_tie_2p" if n == 2 else ("tie" if tied else None)
        return Round(t, not tied, degen, inter, 1.0, n, winner_is_top_skill(ag, ws))


class Performance(Mechanic):
    name, family, arch, lo, hi = "Performance", "catalog", "any", 2, 16
    target = "per-performer 45 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        score = {a.id: 0 for a in ag}
        t = 0.0
        for perf in ag:
            perf.acted = True
            t += 10
            got = 0
            for _ in range(7):  # 35 s window
                t += 5
                for g in ag:
                    if g is perf:
                        continue
                    if rng.random() < 0.7:
                        inter.msg += 1
                        g.acted = True
                        if rng.random() < clamp(0.08 + 0.3 * perf.skill + 0.1 * g.skill, 0.02, 0.7):
                            got += 1
            score[perf.id] += got
        ws, tied = unique_max(score)
        return Round(t, not tied, "tie" if tied else None, inter, 1.0, n, winner_is_top_skill(ag, ws))


class SplitClue(Mechanic):
    name, family, arch, lo, hi = "Split Clue", "catalog", "any", 2, 16
    target = "1.5-2.5 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        pairs = [(ag[i], ag[i + 1]) for i in range(0, n - 1, 2)]
        for a, b in pairs:
            a.acted = b.acted = True
        K, T = 6, 150.0
        progress = {i: 0.0 for i in range(len(pairs))}
        t, winner = 0.0, None
        while t < T and winner is None:
            t += 8
            for i, (a, b) in enumerate(pairs):
                inter.msg += 2  # structural: the puzzle IS the talking
                if rng.random() < 0.45 + 0.45 * (a.skill + b.skill) / 2:
                    progress[i] += 1
                if progress[i] >= K and winner is None:
                    winner = i
        resolved = winner is not None
        ws = [pairs[winner][0].id, pairs[winner][1].id] if resolved else []
        return Round(t, resolved, None if resolved else "no_pair_solved_timeout", inter,
                     (2 * len(pairs)) / n, sum(1 for a in ag if a.acted), winner_is_top_skill(ag, ws))


class BossFight(Mechanic):
    name, family, arch, lo, hi = "Boss Fight", "catalog", "any", 2, 16
    target = "30-90 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        hp = 120 * (n ** 0.8)
        dps = sum(3.0 * (0.5 + 0.5 * a.skill) for a in ag)
        t = hp / dps + 5
        for a in ag:
            a.acted = True
        inter.msg += chatter(ag, rng, t, 2.5)  # cheering, optional
        return Round(t, True, None, inter, 1.0, n, None, ["coop: no loser"])


def smart_flee(a, threats, dt, bounds, rng):
    """Sample headings, keep the one that maximises distance to the nearest
    threat after the step while staying off the walls (real runners juke,
    they don't run straight into corners)."""
    best, bs = a.pos, -1e9
    base = rng.uniform(0, 2 * math.pi)
    for k in range(12):
        ang = base + k * math.pi / 6
        x = clamp(a.pos[0] + math.cos(ang) * a.speed * dt, 0.0, bounds[0])
        y = clamp(a.pos[1] + math.sin(ang) * a.speed * dt, 0.0, bounds[1])
        d = min(dist((x, y), tp) for tp in threats)
        wall = min(x, bounds[0] - x, y, bounds[1] - y)
        s = d - (4.0 - wall) * 1.5 * (wall < 4.0)
        if s > bs:
            bs, best = s, (x, y)
    return best


def intercept_point(chaser, runner, prev_runner_pos, lead_s=0.8):
    """Aim slightly ahead of where the runner is heading."""
    vx = (runner.pos[0] - prev_runner_pos[0]) / 0.5
    vy = (runner.pos[1] - prev_runner_pos[1]) / 0.5
    return (runner.pos[0] + vx * lead_s, runner.pos[1] + vy * lead_s)


class _TagBase(Mechanic):
    W, H, T = 40.0, 40.0, 240.0

    def run_tag(self, ag, rng, snowball):
        n = len(ag)
        inter = Inter()
        W = H = 28.0 + 2.2 * n     # play area scales with headcount (2p: 32 m, 16p: 63 m)
        T = self.T
        dt = 0.5
        n_tag = 1 if snowball else max(1, round(n / 4))
        for a in ag:
            a.pos = rand_pos(rng, (W, H))
            a.alive = True   # alive = still a runner
            a.acted = True
        taggers = set(a.id for a in ag[:n_tag])
        for a in ag:
            if a.id in taggers:
                a.alive = False
        t = 0.0
        active_time = {a.id: 0.0 for a in ag}
        stamina = {a.id: 1.0 for a in ag}
        prev = {a.id: a.pos for a in ag}
        last_press = {}
        while t < T:
            t += dt
            runners = [a for a in ag if a.alive]
            if not runners:
                break
            tg = [a for a in ag if a.id in taggers]
            tpos = [x.pos for x in tg]
            claimed = set()
            for a in ag:
                prev_pos = a.pos
                eff = a.speed * (0.6 + 0.4 * stamina[a.id])
                if a.alive:
                    near = min(dist(a.pos, p) for p in tpos)
                    if near < 12.0:   # sprint only when threatened (burns stamina)
                        a.pos = smart_flee(a, tpos, dt, (W, H), rng)
                        # smart_flee steps at a.speed; rescale to effective (tired) speed
                        dx, dy = a.pos[0] - prev_pos[0], a.pos[1] - prev_pos[1]
                        k = eff / max(1e-6, a.speed)
                        a.pos = (clamp(prev_pos[0] + dx * k, 0, W), clamp(prev_pos[1] + dy * k, 0, H))
                        stamina[a.id] = max(0.0, stamina[a.id] - 0.016 * dt)
                    else:
                        stamina[a.id] = min(1.0, stamina[a.id] + 0.02 * dt)
                    active_time[a.id] += dt
                elif a.id in taggers:
                    # spread: prefer the nearest runner nobody else is already on
                    free = [r for r in runners if r.id not in claimed] or runners
                    target = min(free, key=lambda o: dist(o.pos, a.pos))
                    claimed.add(target.id)
                    aim = intercept_point(a, target, prev[target.id], lead_s=0.6)
                    a.pos = step_toward(a.pos, aim, eff, dt, (W, H))
                    stamina[a.id] = max(0.0, stamina[a.id] - 0.016 * dt)
                    active_time[a.id] += dt
                    d = dist(a.pos, target.pos)
                    if d < 3.0 and t - last_press.get((a.id, target.id), -99) >= 5.0:
                        last_press[(a.id, target.id)] = t
                        inter.prox += 1          # pressure / near-miss: the runner is dodging you
                    if d < 1.5:
                        inter.prox += 1
                        target.alive = False
                        if snowball:
                            taggers.add(target.id)
                            stamina[target.id] = 1.0   # fresh legs join the chase
                prev[a.id] = prev_pos
        runners = [a for a in ag if a.alive]
        degen = None
        if runners and t >= T:
            degen = "timeout_survivors"
        if inter.prox == 0:
            degen = "no_tags"
        active = sum(active_time.values()) / (n * t) if t > 0 else 0
        return Round(t, True, degen, inter, active, n, None)


class DeathTag(_TagBase):
    name, family, arch, lo, hi = "Death Tag / Cops & Robbers", "catalog", "sporty", 2, 16
    target = "2-4 min"

    def play(self, ag, rng):
        return self.run_tag(ag, rng, snowball=True)


class ManhuntTag(_TagBase):
    name, family, arch, lo, hi = "Race / Manhunt-Tag", "superseded", "sporty", 2, 16
    target = "2-4 min"

    def play(self, ag, rng):
        return self.run_tag(ag, rng, snowball=False)


class Timebomb(Mechanic):
    name, family, arch, lo, hi = "Timebomb / Hot Potato", "catalog", "chaos", 2, 16
    target = "45-60 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        W, H = 20.0, 20.0
        T, dt = 45.0, 0.5
        for a in ag:
            a.pos = rand_pos(rng, (W, H))
            a.acted = True
        holder = ag[0]
        t = cooldown = 0.0
        prev = {a.id: a.pos for a in ag}
        last_press = {}
        tosses = 0
        while t < T:
            t += dt
            cooldown = max(0.0, cooldown - dt)
            others = [a for a in ag if a is not holder]
            target = min(others, key=lambda o: dist(o.pos, holder.pos))
            aim = intercept_point(holder, target, prev[target.id])
            hp = holder.pos
            holder.pos = step_toward(holder.pos, aim, holder.speed, dt, (W, H))
            for a in others:
                prev[a.id] = a.pos
                if dist(a.pos, holder.pos) < 9.0:
                    a.pos = smart_flee(a, [holder.pos], dt, (W, H), rng)
            prev[holder.id] = hp
            d = dist(holder.pos, target.pos)
            if d < 3.5 and t - last_press.get((holder.id, target.id), -99) >= 4.0:
                last_press[(holder.id, target.id)] = t
                inter.prox += 1          # near-miss pressure
            if cooldown == 0 and d < 2.0:
                inter.prox += 1
                inter.tap += 1
                tosses += 1
                holder = target
                cooldown = 3.0   # the toss + the new holder turning to chase
        return Round(T, True, "zero_toss" if tosses == 0 else None, inter, 1.0, n, None)


class TileWars(Mechanic):
    name, family, arch, lo, hi = "Tile Wars", "catalog", "sporty", 2, 16
    target = "3 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        G, cell = 16, 2.0
        W = H = G * cell
        T, dt = 180.0, 0.5
        owner = [[-1] * G for _ in range(G)]
        half = n // 2
        for i, a in enumerate(ag):
            a.team = 0 if i < half else 1
            a.pos = (rng.uniform(0, 6), rng.uniform(0, H)) if a.team == 0 else (rng.uniform(W - 6, W), rng.uniform(0, H))
            a.acted = True
        t = 0.0
        half_margin = None
        last_contact = {}   # (id,id) -> t of last counted encounter (rate-limited)
        while t < T:
            t += dt
            for a in ag:
                best, bd = None, 1e9
                cx, cy = int(a.pos[0] // cell), int(a.pos[1] // cell)
                for gx in range(max(0, cx - 4), min(G, cx + 5)):
                    for gy in range(max(0, cy - 4), min(G, cy + 5)):
                        if owner[gx][gy] != a.team:
                            c = ((gx + 0.5) * cell, (gy + 0.5) * cell)
                            d = dist(a.pos, c) + (0 if owner[gx][gy] == -1 else 1.5)
                            if d < bd:
                                best, bd = c, d
                if best is None:
                    best = rand_pos(rng, (W, H))
                a.pos = step_toward(a.pos, best, a.speed, dt, (W, H))
                gx, gy = min(G - 1, int(a.pos[0] // cell)), min(G - 1, int(a.pos[1] // cell))
                if owner[gx][gy] != a.team:
                    owner[gx][gy] = a.team
            # encounters: opponents within 3 m, counted once per pair per 6 s
            for i in range(n):
                for j in range(i + 1, n):
                    if ag[i].team != ag[j].team and dist(ag[i].pos, ag[j].pos) < 3.0:
                        if t - last_contact.get((i, j), -99) >= 6.0:
                            last_contact[(i, j)] = t
                            inter.prox += 1
            if half_margin is None and t >= T / 2:
                c0 = sum(row.count(0) for row in owner)
                c1 = sum(row.count(1) for row in owner)
                half_margin = abs(c0 - c1) / max(1, c0 + c1)
        c0 = sum(row.count(0) for row in owner)
        c1 = sum(row.count(1) for row in owner)
        degen = None
        if c0 == c1:
            degen = "tie"
        elif half_margin and half_margin > 0.6:
            degen = "runaway"
        if inter.prox == 0:
            degen = "teams_never_met"
        return Round(T, c0 != c1, degen, inter, 1.0, n, None, [f"tiles {c0}-{c1}"])


class InfectionZones(Mechanic):
    name, family, arch, lo, hi = "Infection Zones", "catalog", "sporty", 2, 16
    target = "3-4 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        W = H = 50.0
        T, dt = 240.0, 0.5
        GRACE = 9.0
        k = max(1, round(n / 3))

        def new_zone(center):
            life = rng.uniform(22, 32)
            return {"c": center, "ttl": life, "life": life}

        def radius(z):            # zones SHRINK: 4 m -> 1.5 m over their life
            return 1.5 + 2.5 * (z["ttl"] / z["life"])

        def cap(z):               # shoulder-room: how many fit inside right now
            return max(1, int(radius(z) * 1.5))

        k = max(2, round(n / 4)) if n >= 4 else 1
        zones = [new_zone(rand_pos(rng, (W, H))) for _ in range(k)]
        pending = []   # (spawn_t, origin)
        for i, a in enumerate(ag):
            z = zones[i % len(zones)]           # everyone starts at a zone
            a.pos = (clamp(z["c"][0] + rng.uniform(-2, 2), 0, W), clamp(z["c"][1] + rng.uniform(-2, 2), 0, H))
            a.alive = True
            a.acted = True
        t = 0.0
        active_time = {a.id: 0.0 for a in ag}
        exposed = {a.id: 0.0 for a in ag}
        last_jostle = {}
        while t < T:
            t += dt
            alive = [a for a in ag if a.alive]
            if len(alive) <= 1:
                break
            for z in zones:
                z["ttl"] -= dt
            for z in [z for z in zones if z["ttl"] <= 0]:
                zones.remove(z)
                # the world shrinks: after the first minute only ~70% of expired zones come back
                if t < 60 or len(zones) + len(pending) == 0 or rng.random() < 0.7:
                    pending.append((t + 2.0, z["c"]))
            for sp in [p for p in pending if p[0] <= t]:
                pending.remove(sp)
                ang = rng.uniform(0, 2 * math.pi)
                r = rng.uniform(12, 24)
                zones.append(new_zone((clamp(sp[1][0] + math.cos(ang) * r, 3, W - 3),
                                       clamp(sp[1][1] + math.sin(ang) * r, 3, H - 3))))
            # who is safely inside a zone (capacity-limited: closest to centre are in)
            safe = set()
            for z in zones:
                occ = sorted([a for a in alive if dist(a.pos, z["c"]) <= radius(z)],
                             key=lambda a: dist(a.pos, z["c"]))
                for a in occ[:cap(z)]:
                    safe.add(a.id)
                # jostling in a crowded shrinking zone: once per pair per 8 s
                for i in range(len(occ)):
                    for j in range(i + 1, len(occ)):
                        key = (occ[i].id, occ[j].id)
                        if t - last_jostle.get(key, -99) >= 8.0:
                            last_jostle[key] = t
                            inter.prox += 1
            dying = []
            for a in alive:
                active_time[a.id] += dt
                if a.id in safe:
                    exposed[a.id] = 0.0
                    cur = next(z for z in zones if dist(a.pos, z["c"]) <= radius(z))
                    others = [z for z in zones if z is not cur]
                    if cur["ttl"] < 5.0 and others:   # bail early for a fresher zone
                        tz = min(others, key=lambda z: dist(a.pos, z["c"]))
                        a.pos = step_toward(a.pos, tz["c"], a.speed, dt, (W, H))
                    continue
                if t > 8.0:      # opening immunity while everyone finds their feet
                    exposed[a.id] += dt
                if zones:
                    # target: nearest zone with room, weighted away from dying ones
                    def cost(z):
                        room = cap(z) - sum(1 for b in alive if b.id in safe and dist(b.pos, z["c"]) <= radius(z))
                        return dist(a.pos, z["c"]) + (30.0 if z["ttl"] < 4.0 else 0.0) + (12.0 if room <= 0 else 0.0)
                    tz = min(zones, key=cost)
                    a.pos = step_toward(a.pos, tz["c"], a.speed, dt, (W, H))
                if exposed[a.id] > GRACE:
                    dying.append(a)
            if dying:
                if len(dying) == len(alive):
                    dying.remove(min(dying, key=lambda a: exposed[a.id]))
                for a in dying:
                    a.alive = False
        alive = [a for a in ag if a.alive]
        degen = None
        if not alive:
            degen = "wipe_no_winner"
        elif len(alive) > 1:
            degen = "timeout_many_survivors"
        active = sum(active_time.values()) / (n * t) if t else 0
        return Round(t, bool(alive), degen, inter, active, n, None)


# ====================================================================
# NOT YET SHAPED
# ====================================================================
class FiveButtons(Mechanic):
    name, family, arch, lo, hi = "Five Buttons", "unshaped", "chaos", 2, 16
    target = "<30 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        t, presses, loser, i = 0.0, 0, None, 0
        while True:
            a = ag[i % n]
            a.acted = True
            t += 4
            presses += 1
            if rng.random() < 1.0 / (6 - presses):
                loser = a.id
                break
            i += 1
            if presses >= 5:
                break
        inter.msg += chatter(ag, rng, t, 2.0)
        acted = sum(1 for a in ag if a.acted)
        return Round(t, loser is not None, "instant_first_press" if presses == 1 else None, inter,
                     acted / n, acted, None)


class Nim31(Mechanic):
    name, family, arch, lo, hi = "31 (Nim)", "unshaped", "any", 2, 16
    target = "~1 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        pile, t, i, loser = 31, 0.0, 0, None
        while pile > 0:
            a = ag[i % n]
            a.acted = True
            t += 4
            if pile == 1:
                loser = a.id
                break
            if n == 2 and a.skill > 0.7 and (pile - 1) % 4 != 0:
                take = (pile - 1) % 4          # perfect play: leave 1 mod 4
            else:
                take = rng.randint(1, min(3, pile - 1))
            pile -= take
            i += 1
        inter.msg += chatter(ag, rng, t, 1.0)
        acted = sum(1 for a in ag if a.acted)
        degen = None
        if n > 2:
            degen = "kingmaking_multiplayer"
        elif any(a.skill > 0.7 for a in ag):
            degen = "solved_game_perfect_play"
        ws = [a.id for a in ag if a.id != loser] if n == 2 else []
        return Round(t, True, degen, inter, acted / n, acted,
                     winner_is_top_skill(ag, ws) if n == 2 else None)


class TruthOrDare(Mechanic):
    name, family, arch, lo, hi = "Truth or Dare", "unshaped", "chaos", 2, 16
    target = "per-turn 45 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        t = 0.0
        for a in ag:
            a.acted = True
            t += 45
            inter.msg += 2  # prompt aimed at the player + their answer (structural)
            inter.msg += chatter([b for b in ag if b is not a], rng, 45, 1.5)
        return Round(t, False, "no_win_condition", inter, 1.0, n, None)


class LiarGame(Mechanic):
    name, family, arch, lo, hi = "Liar Game / Mafia", "unshaped", "chaos", 2, 16
    target = "2-4 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        liar = rng.choice(ag)
        t = 0.0
        for a in ag:  # everyone describes in turn — structural
            a.acted = True
            inter.msg += 1
            t += 12
        disc = chatter(ag, rng, 45, 2.5)
        inter.msg += disc
        t += 45
        mean_skill = sum(a.skill for a in ag) / n
        p_caught = clamp(0.5 + 1.2 * (mean_skill - liar.bluff) + 0.15 * min(1.0, disc / n), 0.12, 0.92)
        votes = {a.id: 0 for a in ag}
        for a in ag:
            if a is liar:
                target = rng.choice([b for b in ag if b is not a])
            else:
                pool = [b for b in ag if b is not a and b is not liar] or [liar]
                target = liar if rng.random() < p_caught else rng.choice(pool)
            votes[target.id] += 1
            inter.tap += 1
        t += 15
        ws, tied = unique_max(votes)
        resolved = not tied
        degen = None
        if n == 2:
            degen, resolved = "two_player_coinflip", False
        elif tied:
            degen = "vote_tie"
        caught = resolved and ws == [liar.id]
        winners = [a.id for a in ag if a is not liar] if caught else ([liar.id] if resolved else [])
        return Round(t, resolved, degen, inter, 1.0, n, winner_is_top_skill(ag, winners))


class TeeGame(Mechanic):
    name, family, arch, lo, hi = "Tee Game (photo + slogan)", "unshaped", "chill", 2, 16
    target = "~90 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        t = 40.0
        combo_q = {}
        for i, a in enumerate(ag):
            a.acted = True
            b = ag[(i + 1) % n]
            combo_q[i] = clamp((a.skill + b.skill) / 2 + rng.gauss(0, 0.3), 0, 1.5)
        votes = {i: 0 for i in range(n)}
        for i, a in enumerate(ag):
            choices = [j for j in range(n) if j != i and j != (i - 1) % n] or [j for j in range(n) if j != i]
            pick = rng.choices(choices, [combo_q[j] + 0.05 for j in choices])[0]
            votes[pick] += 1
            inter.tap += 1
        t += 30
        inter.msg += chatter(ag, rng, 30, 2.5)
        ws, tied = unique_max(votes)
        degen = "always_tie_2p" if n == 2 else ("tie" if tied else None)
        return Round(t, not tied and n > 2, degen, inter, 1.0, n, None)


class GuessTheNumber(Mechanic):
    name, family, arch, lo, hi = "Guess the Number (timing imposter)", "unshaped", "chaos", 2, 16
    target = "~75 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        imp = rng.choice(ag)
        t = 10.0
        err = {}
        for a in ag:
            a.acted = True
            if a is imp:
                err[a.id] = abs(rng.gauss(0, 1.0 * (1 - 0.5 * a.bluff)))
            else:
                err[a.id] = abs(rng.gauss(0, 0.12 + 0.35 * (1 - a.skill)))
        worst = max(err, key=err.get)
        disc = chatter(ag, rng, 40, 2.0)
        inter.msg += disc
        t += 40
        votes = {a.id: 0 for a in ag}
        p_focus = clamp(0.55 + 0.25 * min(1.0, disc / n), 0.5, 0.9)
        for a in ag:
            others = [b for b in ag if b is not a]
            target = worst if (worst != a.id and rng.random() < p_focus) else rng.choice(others).id
            votes[target] += 1
            inter.tap += 1
        t += 20
        ws, tied = unique_max(votes)
        resolved = not tied and n > 2
        degen = None
        if n == 2:
            degen = "two_player_coinflip"
        elif tied:
            degen = "vote_tie"
        caught = resolved and ws == [imp.id]
        winners = [a.id for a in ag if a is not imp] if caught else ([imp.id] if resolved else [])
        return Round(t, resolved, degen, inter, 1.0, n, winner_is_top_skill(ag, winners),
                     ["imposter not the worst timer"] if worst != imp.id else [])


class CatchTheImposter(Mechanic):
    name, family, arch, lo, hi = "Catch the Imposter", "unshaped", "chaos", 2, 16
    target = "~90 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        n_imp = 2 if n >= 10 else 1
        imps = rng.sample(ag, n_imp)
        t = 20.0
        for a in ag:
            a.acted = True
        disc = chatter(ag, rng, 40, 2.5)
        inter.msg += disc
        t += 40
        votes = {a.id: 0 for a in ag}
        for a in ag:
            others = [b for b in ag if b is not a]
            if a in imps:
                target = rng.choice([b for b in others if b not in imps] or others)
            else:
                imp = rng.choice(imps)
                blend = clamp(0.2 + 0.5 * imp.bluff - 0.15 * min(1.0, disc / n), 0.05, 0.85)
                target = rng.choice(others) if rng.random() < blend else imp
            votes[target.id] += 1
            inter.tap += 1
        t += 20
        ws, tied = unique_max(votes)
        resolved = not tied and n > 2
        degen = None
        if n == 2:
            degen = "two_player_coinflip"
        elif tied:
            degen = "vote_tie"
        caught = resolved and ws[0] in [i.id for i in imps]
        winners = [a.id for a in ag if a not in imps] if caught else ([i.id for i in imps] if resolved else [])
        return Round(t, resolved, degen, inter, 1.0, n, winner_is_top_skill(ag, winners))


# ====================================================================
# SUPERSEDED / REFERENCE
# ====================================================================
class RivalTeams(Mechanic):
    name, family, arch, lo, hi = "Rival Teams (generic)", "superseded", "sporty", 4, 16
    target = "2 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        half = n // 2
        T = 120.0
        s0 = sum(ag[i].skill * rng.uniform(0.8, 1.2) for i in range(half))
        s1 = sum(ag[i].skill * rng.uniform(0.8, 1.2) for i in range(half, n))
        for a in ag:
            a.acted = True
        inter.msg += chatter(ag, rng, T, 1.2)  # team talk, optional — task unspecified
        degen = None
        if abs(s0 - s1) < 0.05:
            degen = "tie"
        elif max(s0, s1) / max(0.01, min(s0, s1)) > 1.6:
            degen = "runaway_by_skill_sum"
        ws = [a.id for i, a in enumerate(ag) if (i < half) == (s0 > s1)]
        return Round(T, s0 != s1, degen, inter, 1.0, n, winner_is_top_skill(ag, ws), ["framework, not a mechanic"])


class Scavenger(Mechanic):
    name, family, arch, lo, hi = "Scavenger (planted object)", "superseded", "chill", 2, 16
    target = "5-10 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        T = 480.0
        finish = {}
        for a in ag:
            a.acted = True
            t = rng.uniform(90, 200) / (a.speed * 0.55)  # walking pace to the clue site
            while t < T:
                t += 30
                if rng.random() < 0.18 * (0.5 + a.skill):
                    finish[a.id] = t
                    break
        inter.msg += chatter(ag, rng, 240, 0.6)  # walking together, optional
        if not finish:
            return Round(T, False, "nobody_found_it", inter, 1.0, n, None, ["needs physical pre-setup"])
        w = min(finish, key=finish.get)
        return Round(finish[w], True, None, inter, 1.0, n, winner_is_top_skill(ag, [w]), ["needs physical pre-setup"])


class AccuracyLongJump(Mechanic):
    name, family, arch, lo, hi = "Accuracy / Long Jump", "superseded", "sporty", 2, 16
    target = "per-player 45 s"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        best, t = {}, 0.0
        for a in ag:
            a.acted = True
            best[a.id] = max(a.skill * rng.gauss(1.0, 0.12) for _ in range(3))
            t += 45
        inter.msg += chatter(ag, rng, t, 1.2)  # watching others, optional
        ws, tied = unique_max(best)
        return Round(t, not tied, "tie" if tied else None, inter, 1.0 / n, n, winner_is_top_skill(ag, ws))


class TeamChallenge(Mechanic):
    name, family, arch, lo, hi = "Team Challenge (2p coop physical)", "superseded", "sporty", 2, 16
    target = "1-2 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        pairs = [(ag[i], ag[i + 1]) for i in range(0, n - 1, 2)]
        K, T = 8, 120.0
        done = {i: 0 for i in range(len(pairs))}
        t, winner = 0.0, None
        for a, b in pairs:
            a.acted = b.acted = True
        while t < T and winner is None:
            t += 6
            for i, (a, b) in enumerate(pairs):
                inter.msg += 1    # coordinating call
                inter.prox += 1   # synced physical action
                if rng.random() < 0.45 + 0.4 * min(a.skill, b.skill):
                    done[i] += 1
                if done[i] >= K and winner is None:
                    winner = i
        resolved = winner is not None
        ws = [pairs[winner][0].id, pairs[winner][1].id] if resolved else []
        return Round(t, resolved, None if resolved else "timeout", inter, 2 * len(pairs) / n,
                     sum(1 for a in ag if a.acted), winner_is_top_skill(ag, ws))


class HideAndSeek(Mechanic):
    name, family, arch, lo, hi = "Hide and Seek", "superseded", "sporty", 2, 16
    target = "4-6 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        T = 300.0
        n_seek = max(1, n // 6)
        seekers, hiders = ag[:n_seek], ag[n_seek:]
        for a in ag:
            a.acted = True
            a.alive = True
        t = 30.0
        sk = sum(s.skill for s in seekers) / n_seek
        active_time = {a.id: 0.0 for a in ag}
        while t < T and any(h.alive for h in hiders):
            t += 1
            for a in ag:
                if a.alive or a in seekers:
                    active_time[a.id] += 1
            for h in hiders:
                if h.alive and rng.random() < n_seek * 0.009 * (1 - 0.5 * h.skill) * (0.5 + sk):
                    h.alive = False
                    inter.prox += 1
        left = [h for h in hiders if h.alive]
        degen = None
        if inter.prox == 0:
            degen = "nobody_found"
        elif left and t >= T:
            degen = "timeout_hiders_win"
        return Round(t, True, degen, inter, sum(active_time.values()) / (n * t), n, None)


class Consensus(Mechanic):
    name, family, arch, lo, hi = "Consensus (debate to agree)", "superseded", "chill", 2, 16
    target = "1-3 min"

    def play(self, ag, rng):
        n = len(ag)
        inter = Inter()
        opinion = {a.id: rng.randrange(4) for a in ag}
        T, t = 180.0, 0.0
        for a in ag:
            a.acted = True
        instant = len(set(opinion.values())) == 1
        while t < T and len(set(opinion.values())) > 1:
            t += 10
            counts = {}
            for v in opinion.values():
                counts[v] = counts.get(v, 0) + 1
            plur = max(counts, key=counts.get)
            spoke = 0
            for a in ag:
                if rng.random() < 0.35 + 0.6 * a.social:  # speaking is how you move the room
                    inter.msg += 1
                    spoke += 1
            if spoke:
                for a in ag:
                    if opinion[a.id] != plur and rng.random() < 0.12 + 0.35 * a.social:
                        opinion[a.id] = plur
        agreed = len(set(opinion.values())) == 1
        degen = None
        if instant:
            degen = "instant_agreement"
        elif not agreed:
            degen = "no_consensus_timeout"
        return Round(max(t, 10), agreed, degen, inter, 1.0, n, None, ["coop: no winner"])


ALL = [
    OrderUp, SplitOrSteal, SheepRaid,
    TriviaStandard, MajorityRules, HigherLower, DrawMyThing, CaptionThis, Performance,
    SplitClue, BossFight, DeathTag, Timebomb, TileWars, InfectionZones,
    FiveButtons, Nim31, TruthOrDare, LiarGame, TeeGame, GuessTheNumber, CatchTheImposter,
    RivalTeams, Scavenger, ManhuntTag, AccuracyLongJump, TeamChallenge, HideAndSeek, Consensus,
]
