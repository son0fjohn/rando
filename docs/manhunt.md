# Manhunt

Hide-and-seek on foot round the real neighbourhood, played on the live 3D
map (city mode). Hunters chase, runners hide; every few minutes the hunters
get a ping: a fuzzy circle round where each runner **was**. Tags happen in
person and the runner confirms them. Its host is The Hunter in his elevator
(`docs/npc_scenes.md`). Code: `web/hpgames/manhunt.js` (the game),
`web/mhgeo.js` (the rules with no screen), `web/mhmap.js` (the map layer),
`web/mhcrypt.js` (the team channel), `web/mhscene.js` (the Hunter's moments).
Numbers: `hpconfig.js` `MANHUNT`.

## The flow

1. **Setup** (the host): draw the zone on the map (a circle: tap to move it,
   a slider for its size; or a shape: 3–12 corners), 300 m to 3 km across.
   Round 10 min–2 h (30), a ping every 1–15 min (5), a head start of 0–10
   min (3), shrinking zone, powers, tagged runners join the hunters (all on).
   Teams: Hunter / Runner / Random per player; Random fills the smaller team
   (about one hunter per four). It won't start under 3 players, without a
   zone, or with badly lopsided teams ("about 1 hunter per 3–4 runners").
   The host is warned when the zone crosses a major road (from the map's own
   road data). Everyone else waits in the lobby.
2. **The rules card** for everyone: your role, the safety rules ("Stay on
   foot. No roads, no private property, no going inside homes or
   businesses. Watch traffic."), what's shared about your location. Tapping
   "I'm in" also asks for location permission now, not mid-hunt.
3. **The Hunter's opening:** the doors open, three lines, the doors close.
4. **The head start:** runners go; hunters get the elevator, doors shut,
   "No peeking.", the minutes on the counter. The map is hidden for them.
5. **The hunt:** a ping on schedule (hunters: the small elevator window, 3-2-1,
   ding, then the circles on the map, fading till the next one; runners: a
   buzz and a toast). The zone shrinks in steps (at 50 %, 70 %, 85 % of the
   round, to 80 %, 65 %, 50 %), each a minute after a warning (a dashed gold
   line where it will be). Top bar: role, time left, next ping, runners left;
   "no signal: …" for runners whose last ping didn't come.
6. **The end:** every runner caught (hunters win: "Told you. Nobody hides
   forever."), or the clock runs out with anyone free (runners win:
   "...Fine. Respect."), or the host ends it. The Hunter holds the WANTED
   posters, then the board: CAUGHT stamps with the time and who, ESCAPED,
   Last Survivor, points. It counts as one of the party's 3 games.

**Points:** a tag is 100 + up to 100 more the earlier it lands; runners get
10 a minute free (SAFE time doesn't count), 150 for lasting to the end, 100
for Last Survivor (the last one free, or the last caught).

**Tags:** a hunter picks who they touched; that runner's phone asks "Did X
just tag you?" (45 s to answer, no answer = no tag). Caught runners join the
hunters (or spectate, if that's off).

**Leaving the zone** (checked on the runner's phone): a buzz at once; after
30 s outside, a tight 25 m circle every 5 s goes to the hunters (live) until
you're back; after 2 minutes, you're out.

**SAFE:** hides you from the hunters (no pings, no tags), stops your clock,
tells the host; "I'm back in" resumes.

**Powers** (once each per game, a button row): runners have Decoy (your next
ping lands 200–450 m away, still in the zone), Ghost (you skip the next
ping: it looks like "no signal"), Sprint Alert (60 s of buzzing if a hunter
is within ~100 m; no direction, nothing on screen); hunters have Radar
(everyone pings now) and Lock-on (one runner's next ping is a ~20 m circle).
Using one gets a Hunter line.

## Privacy

- Your phone reads its GPS only during the head start and the hunt, only
  while you're still in it; it stops at the end (or when you're caught and
  not hunting). Nothing about where you were is ever saved.
- A ping sends a **fuzzy circle**, never your spot: 50 m wide at the start,
  tightening to 25 m by the end; its centre is moved a random way (up to 0.8
  of its radius) and snapped to a 10 m grid, a fresh draw each time (so
  pings can't be averaged back to your spot).
- Circles are a broadcast that phones keep in memory until the game ends;
  they're never in the synced state and never stored. The state holds roles,
  tags, flags (outside, SAFE, quiet) and the zone, which is a place, not a
  person.
- Teammates see each other as the same fuzzy circles, every 20 s, end-to-end
  encrypted to the team (ECDH P-256 + AES-GCM, `mhcrypt.js`); team chat too.
  The other team's phones, the host's included, only get ciphertext.
- Runners never see hunters. Sprint Alert's circles are sealed to that one
  runner, whose phone only buzzes.
- Vibration only; no sound unless you turn it on (a ding could give a
  hiding spot away).

## The web vs. a native app

What a web page can do, and what Manhunt does about it:

| | Web (this) | Needs a native app |
| --- | --- | --- |
| Location while the screen is on and the page is open | yes (`watchPosition`) | |
| Keeping the screen on | Wake Lock (`navigator.wakeLock`), requested at the head start and on every return; iOS Safari 16.4+, Chrome | |
| Location with the **screen locked** or the browser in the background | **no**: the page is frozen; the phone tells the host it went quiet (`mh-asleep`), and the hunters see "no signal" at that ping | background location (iOS "Always" / Android foreground service) |
| A ping's alert with the screen locked | **no**: vibration only works while the page is visible | a local or push notification with vibration and sound |
| Vibration | Android Chrome; **not iOS Safari** (no `navigator.vibrate`): the toasts and the elevator window carry it there | haptics on both |
| Sprint Alert's buzz in a pocket | only with the screen on (Android) | a background proximity check + notification |
| Geofence "you left the zone" while locked | no | OS geofencing |

So on the web the rule for players is: **keep the screen on during the
hunt** (Wake Lock does this while the page is open; the rules card says
it). A locked phone isn't cheating, it just shows as "no signal" and can't
be pinged; a native app would make pings, Sprint Alert and the zone warning
work from a pocket.

## Testing

- `npm test`: the Manhunt groups in `test/specs.js` (setup, the phases,
  privacy on the wire and in the state, leaving the zone, tags, SAFE,
  powers, a locked phone, the end and points), 5 phones, simulated GPS.
- `node test/manhunt_rec.mjs <dir>`: the real app page on 2 phones and the
  party page on 3, `?mhsim=1` (each phone walks round the zone) and
  `?mhfast=12` (a game minute lasts 5 s); a screen locked through a ping;
  writes shots and `manhunt.mp4` (with `FFMPEG=...`).
- Dev flags: `?mhsim=1` (a pretend walker; `?mhsim=out` walks out of the
  zone), `?mhfast=N`, `?mh3d=0` (the Hunter as a flat card).
