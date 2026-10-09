# Dev stack

| Tool | Job | In the repo | Your setup |
|---|---|---|---|
| **T3 Code** | run several coding agents (Codex, Claude Code) in parallel, one worktree each | `AGENTS.md` (+ `CLAUDE.md` → it) is what those agents read | install, add this repo |
| **Codex** | review every PR on GitHub | `AGENTS.md` → *Code Review Rules*, *Review guidelines* | connect GitHub, turn on automatic review |
| **GitHub Actions** | run the tests on every PR, on Chrome and iPhone Safari's engine | `.github/workflows/test.yml` | nothing — runs on its own |
| **Mobbin** | real app screens as design reference, inside the agents | `.mcp.json` (Claude Code) | paid Mobbin plan, sign in once |
| **Mac mini + Xcode** | real Mobile Safari on simulated iPhones; several players on one machine | `scripts/ios-sim.sh` | buy, install Xcode |
| **Tailscale** | reach the Mac from anywhere; give real phones HTTPS to un-pushed changes | — | install on Mac, laptop, iPhone |

## How a change flows

1. An agent (in T3 Code, Claude Code or Codex) works on a branch, following `AGENTS.md`, and opens a PR.
2. CI runs `npm test` and the three-phone party test on Chromium and WebKit/iPhone. Screenshots are attached to the run.
3. Codex reviews the PR against the rules in `AGENTS.md`.
4. Vercel posts a preview URL on the PR: open it on real phones.
5. For anything the preview can't settle (simulated GPS, several Safari players at once, screenshots on many sizes), use the Mac mini.
6. Merge → production.

---

## T3 Code

Open-source desktop/web app (pingdotgg/t3code, t3.codes) that drives the
official agent CLIs; it doesn't have its own model. It's still alpha.

1. Install it on the machine you code from (or the Mac mini) and sign the
   agent CLIs in (`codex`, `claude`).
2. Add this repo as a project. Start one thread per task; each gets its own
   worktree, so parallel agents don't trip over each other.
3. The agents read `AGENTS.md` for how to run, test and not break things.
   Tell them to finish with `npm test` and a PR.

Keep T3 Code's web/server mode on localhost or your tailnet — never expose
it to the internet (it can run commands on the machine).

## Codex code review

1. In Codex (chatgpt.com/codex) → settings → connect GitHub and give the
   Codex app access to `son0fjohn/rando`.
2. Code review → this repo → turn on **Automatic review**, trigger **every
   push** (this repo's setting), so follow-up commits to a PR get reviewed
   too, not just the first version. Without automatic review, comment
   `@codex review` on a PR to ask for one.
3. Rules live in `AGENTS.md`. Codex only comments on serious (P0/P1) issues by
   default and leaves a 👍 when it finds nothing.
4. `@codex fix it` on a finding starts a task that pushes a fix to the PR.
5. Check it's live: on any open PR, Codex reacts 👀 within a minute or so of
   a push (or of an `@codex review` comment). No reaction means automatic
   review is off, or the Codex GitHub app can't post to this repo. Check
   GitHub → Settings → Applications → **Installed GitHub Apps** → *ChatGPT
   Codex Connector* → Configure → Repository access includes `rando`. (If
   a private review inside the Codex app works but nothing appears on GitHub,
   it's this app: Codex can read the repo but can't post to it.)

A Codex review is not an approval — anything touching auth, the database or
the 18+ / privacy rules still gets a human look.

To also block merging on red tests: GitHub → Settings → Branches → add a rule
for `main` requiring the `test` checks.

## Mobbin (needs a paid plan)

- **Claude Code:** `.mcp.json` registers it for this repo. Approve it the first
  time, then `/mcp` → mobbin → Authenticate (opens a browser to sign in).
  Or for every project: `claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp`
- **Codex CLI:** add to `~/.codex/config.toml` (check Mobbin's Codex page if
  the format has changed):
  ```toml
  [mcp_servers.mobbin]
  url = "https://api.mobbin.com/mcp"
  ```
- Use: "find onboarding screens from party/social apps on Mobbin and use them
  as reference for the lobby" — the agent searches screens and flows.

## Mac mini, Xcode and the iOS Simulator

Rando is a web app, so nothing gets *built* with Xcode — the simulator is
for running **real Mobile Safari**. Any Apple-silicon Mac mini handles Xcode
plus several simulators; the base model is enough.

Setup:
1. Install Xcode from the App Store, open it once, and in
   Xcode → Settings → Components add the latest iOS runtime.
2. Install Node 22 and clone the repo; `npm ci`.

Play a party on three simulated iPhones:
```
scripts/ios-sim.sh up 3                  # boots "Rando 1..3", opens randoirl.vercel.app in each
# throw a party on Rando 1, read the 4-letter code
scripts/ios-sim.sh join ABCD             # Rando 2 and 3 join it
scripts/ios-sim.sh shot                  # sim-shots/phone-1.png …
scripts/ios-sim.sh where 53.5232,-113.5263   # Manhunt: put the phones on the map
scripts/ios-sim.sh down
```
Each simulator is its own guest player; no phone numbers needed.
To test local changes: `npm run serve`, then `scripts/ios-sim.sh up 3 http://localhost:8743/`.

What the simulator can't tell you: walking with real GPS, the camera, battery
and heat over a 15-minute Manhunt, real touch and performance. Use real
phones for those (the PR's Vercel preview, or Tailscale below).

### Letting an agent run device tests

Agents only reach the Mac mini when they run **on** it. Cloud sessions
can't reach your tailnet. Two ways:
- run T3 Code on the Mac mini, or
- in a terminal on the Mac, in the repo: `claude remote-control`. That session
  shows up in the Claude Code app on your phone and laptop, and it can run
  `scripts/ios-sim.sh` and the tests on the real simulators.

## Tailscale

Install on the Mac mini, your laptop and your iPhone, and sign them into the
same tailnet.
- **Reach the Mac from anywhere:** macOS Settings → General → Sharing →
  turn on *Remote Login* (SSH) and *Screen Sharing*. Then
  `ssh you@mac-mini` or Screen Sharing to `mac-mini` from your laptop, over
  Tailscale, to watch the simulators.
- **Real phones on un-pushed changes:** on the Mac, `npm run serve`, then
  `tailscale serve --bg 8743`. It prints an `https://mac-mini.<tailnet>.ts.net`
  URL that opens on any phone in your tailnet. It has to be HTTPS:
  geolocation, the camera and Wake Lock don't work over plain `http://` on a
  phone.
- Pushed changes don't need this: every PR gets a Vercel preview URL.
