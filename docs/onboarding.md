# Onboarding: first open → playing with friends in under a minute

One goal: someone opens Rando (usually from a friend's invite) and is in a
game with that friend within ~60 seconds. Code: `web/onboard.js` (the
screens), `web/onbkit.js` (the pure parts), `web/i18n.js` (English and
Korean), `web/permissions.js` (pre-prompts), `web/analytics.js` +
`supabase/migrations/017_events.sql` (events), `api/invite.mjs` (the invite
link's preview), `web/stats.html` (the dashboard).

## The start screen (every open)

The first screen, every time: our real 3D Itaewon at night, full screen,
behind one frosted glass panel (`.glass` in `theme.css`) with the logo,
**Start a party** (gold) and **Join a party** (clear glass). `web/scenery.js`
turns the map into pure scenery while it's up: no players, no mascots, no
labels or pins, no nav bar; the camera drifts slowly round a loop over the
busiest blocks (station, Ikovox cafe, Grand Ole Opry), at 30 fps. The app
always opens at night now (`index.html` sets `__RANDO_FIRST_NIGHT` unless
`?onb=0`).

- **Nobody waits on the 3D.** `web/start/night.jpg` is the drift's first
  frame, shown from the first paint (`html.start-boot`), and crossfades to
  the live city once the buildings are up. Re-shoot it with
  `node test/start_rec.mjs --still` when the city or the path changes.
- **Slow phones.** Frames are timed in 1.5 s windows while it's up; two
  windows in a row with a median over 50 ms turn
  the glass "lite" (`body.glass-lite`: a deeper tint, no live blur)
  and drop the city to 20 fps. No `backdrop-filter`, or reduced
  transparency: lite too. Reduced motion: the city holds still and there's
  no dive.
- **Start a party** → (a first open: the setup card, below) → the party
  opens with its room still hidden → the panel fades and scales away while
  the camera dives (~1.5 s) from the sky into the party's building (picked
  by the party code: everyone in a party dives into the same one) → navy
  for a beat → the lobby and the invite sheet. If the 3D isn't drawing yet,
  no dive: straight in.
- **The setup card** (first-timers only: a guest still on its placeholder
  handle, or with no character; `onbkit.js` `needsSetup`). Start, Join, an
  invite link and Explore all show it first, as the same glass panel with
  its insides swapped, over the same drifting city: the character on a
  small stage, **3D / 2D** in its corner (the live 3D model, or exactly the
  party room's own pixel sprite, big and crisp: `charview.js`
  `mountLookView`, the choice kept in `localStorage` `rando-look-mode`),
  **Randomize** over it, one tap per essential (Skin, Hair, Color, Eyes,
  Outfit, Hat: `onbkit.js` `cycleLook`, free things only), the name field
  focused with a random name already in it and selected (keep it with one
  tap, or just type), **Let's go**. No title, nothing to read: ~10
  seconds, then straight on into whatever they tapped. A taken default
  name is swapped for another one. The full wardrobe stays in Style.
- **Returning players** skip it. The panel shows their chip on top (their
  room sprite and name); tapping it opens the same card to edit (Save /
  Back).
- **Join a party** flips the panel to the code, friends' public parties and
  "See what's happening nearby" (the map); joining dives the same way.
- **Explore the world** (a quiet text button with a map icon under the
  two): no party, the map itself. A location pre-prompt (once); the panel
  fades, the camera glides down onto the map's own view over where you are
  (your location read on the phone if allowed, else Itaewon), the nav bar
  slides up, the pins and spots fade in. Far from Itaewon the city there
  swaps in under a quick navy blink first (`docs/map_city.md`).
- Corners: EN / 한 (left), You (Home) and Settings (right).
- **The lobby** has one way out: back (top left) → "Leave the party?" →
  the explore map. The host also has the host menu (top right: the game
  votes sheet with the party settings). No nav bar.
- **Out of a party**, every way (Leave, the host ending the party after the
  set's podium, the host turning you away past the cap) lands the same
  (`party.exit` → `onboard.toWorld`): the room fades to navy, the camera
  pulls out of the party's building onto you (`scenery.pullOut`, the dive
  backwards), the bar slides in. Nothing over the map: no host menu, no
  start screen, no Home, no sheet or toast (`test/leave_rec.mjs`).

## Path A: an invite link (the main path)

1. The host's invite is `https://randoirl.vercel.app/p/CODE?n=<party name>&c=<people>`.
   `api/invite.mjs` (a Vercel function; `vercel.json` rewrites `/p/:code`)
   answers with the night-sky OG card and the title "Jae's party · 4 inside"
   (Korean phones: "Jae's party · 4명 참여 중"), then sends the browser to
   `/?party=CODE&from=invite`. Parties live in no table, so the name and the
   count ride in the link (the count as it was when shared).
2. The start screen with no buttons: "You're invited", the party's name and
   "Joining…" on the glass. It peeks into the party without joining it
   (`net.js` `peekRoom`: the host answers with the name, the members and
   their looks); their characters warm up meanwhile.
3. A first open: the setup card on the same glass (a random name to keep
   or replace, the character in 3D or as the room's 2D sprite, Randomize,
   the essentials, Let's go) → the same dive straight into the room:
   "You're in!", everyone already there waves.
4. An ended or full party says so on the glass and offers Start / Join.
5. The code is kept on the phone (12 h) until they're in, so a reload, a
   sign-in or an interrupted install that reopens the app comes back to the
   same party.

## Home

The "You" button on the start screen: your character, Style, friends'
public parties, what's new (tap to dismiss), join with a code, EN / 한 and
Settings. Starting a party (here or on the start screen) creates an
invite-only party at once and opens the invite sheet: Share link (the
phone's share sheet: KakaoTalk, iMessage, Instagram…), Messages, Copy link,
Invite from contacts (where the Contact Picker exists: Android Chrome), and
the QR code (tap it to show it big). Alone in your own room: "Invite your
friends: games work best with 3+" with the QR, big. The map has a button
back to the start screen (top left).

## Accounts: guests first, saved with one tap

Anyone can open the app or an invite link and play right away with just a
name and a character: no phone, no email. That's a guest account (Supabase
anonymous sign-in), kept on the phone (the session in localStorage).

**Save your account** links Kakao (first: it's how Korea logs in), Apple or
Google to that same account with `linkIdentity`, so the user id, character,
coins, friends and history all stay. It's offered at the natural moments:
the first party's recap, Settings, and, for a new phone, "Already have an
account? Sign in" on the name screen and in Settings (`signInWithOAuth`;
that phone becomes that account, its own guest progress stays behind).
Both leave for the provider and come back to the same page; `st.oauth`
(onboard.js) remembers why and which party, so they land back in it, with
"Saved with Kakao". A provider account that already belongs to someone else
comes back as `identity_already_exists`: the app offers to sign in with it
instead, or to keep playing as a guest. Only the providers the Supabase
project has switched on are shown (`/auth/v1/settings`); Google is hidden
inside KakaoTalk / Instagram's in-app browsers, where Google refuses to sign
in. Existing accounts keep working: phone sign-in stays in Settings.

**Setup (Supabase dashboard):**
- Authentication → Sign In / Providers: turn on **Allow manual linking**
  (linkIdentity needs it) and keep **Allow anonymous sign-ins** on.
- Authentication → URL Configuration → Redirect URLs: add
  `https://randoirl.vercel.app/**`, `https://*-randoirl.vercel.app/**` (the
  previews) and `http://localhost:8743/**`.
- **Kakao** (a built-in Supabase provider): Kakao Developers → create an app
  → Kakao Login on → Redirect URI
  `https://ghhenktihhjqnhtmacin.supabase.co/auth/v1/callback`; consent items
  profile_nickname, profile_image (account_email needs Kakao's business
  verification: until then, use Supabase's "allow users without an email"
  option for Kakao if your project offers it, or get the app verified) →
  REST API key = client ID, Client Secret (Security tab) = secret → paste
  both into Supabase → Providers → Kakao.
- **Apple**: needs the Apple Developer Program; a Services ID, a Sign in with
  Apple key; Supabase → Providers → Apple. The secret key expires every six
  months.
- **Google**: a Google Cloud OAuth client (Web), the same callback URL;
  Supabase → Providers → Google.

## Phone verification: the stranger features only

Required only for: making a party public, joining public parties (from the
map or a friend's), adding friends (the in-person "We met" confirm), and
earning and spending coins. Never for private parties with friends: hosting
one, joining by link or code. Each ask has one line of why ("Verify your
number to play with people nearby. Keeps everyone safe."). A game's coins
wait, unclaimed, until the number is verified ("Coins wait for a verified
number · Verify"), then they're all collected. A Kakao account counts as
verified (it's tied to a phone number already), so "Continue with Kakao" is
offered right in the phone sheet.

A guest gets the number linked to the same account (`updateUser({ phone })` +
`verifyOtp(type: "phone_change")`); another phone signs in with it
(Settings). Numbers are sent as E.164: 010-…, +82 010…, 0082 10… and 82 10…
all become +8210… (`onbkit.js` `e164`).

**Codes:** this phone asks at most once every 30 s and 5 times an hour
(`otpWait`), on top of the server's own limit (its "only request this after
N seconds" is honoured). The code step says "Didn't get it? Try again in 30s
or sign in with Kakao", then offers Send it again. A failure is shown plainly
(the provider refused, too soon, a bad code) and logged as a reason only
(`verification_failed`), never the number or the server's text.

**Switches:** `FLAGS.PHONE_VERIFY` (`web/hpconfig.js`, on) turns every gate
off when false. The gates only run where the project can verify someone
(its Phone provider, or Kakao). They're enforced in the app; the SQL doesn't
check verification yet (a next step: `confirm_game` / `buy_item` could
require it). Korean 본인인증 (PASS / NICE) would be the native app's.

## Permissions at their moment

Never on the first screen. Each gets a pre-prompt card before the system's
own dialog, and "Not now" always works (a note says Settings can turn it on):

| | When | Pre-prompt |
| --- | --- | --- |
| Location | Join a party → "nearby", the Explore tab (going visible), Manhunt's "I'm in" | "See parties happening nearby. We only show your area, never your exact spot." |
| Notifications | right after the first finished game; again as a button on the recap | "Want to know when friends throw a party?" |
| Contacts | only on "Invite from contacts" | "Pick who to text. Your contacts never leave your phone." |
| Camera / photos | the first time you add an Art Gallery photo | "Take or pick photos for this game. They're gone when the party ends." |

Settings shows each one's state and a Turn on (or, when the browser has it
blocked, where to allow it). Web push delivery itself isn't built: the
permission is asked so it's ready; sending needs a push service (below).

## The first game

- Before the first game (not before joining): one card, "Be cool. No
  harassment. Respect people's no. Report anything weird.", Got it. Tap
  anyone in the room to report or block them.
- Every game opens with its host explaining it in the game itself
  (web/howto.js): The Prophet, The Boss, Bunny, The Hunter (role by role);
  The Diary and The Table for the hostless games. 2–4 short lines with a
  gesture each, in the game's dialog box at the bottom, the first time a
  phone plays it; after that one line and a "How to play" button.
- One-time hints where people get stuck: the vote button for a new player,
  the Game votes button for a host with people in.
- The Game votes sheet marks Humiliation Ritual "Great first game" until the
  party has played one.

## The first party's recap

After the first party's three games (once per phone): everyone's characters
together, "You played 3 games with Jae, Mina and Sol", the best moment if
there is one (Side Quest's top-rated quest, Art Gallery's winning title),
the coins earned, Throw your own party (gold), Share (a 1080×1350 picture
with the characters, the line, the moment and the link, through the share
sheet), Save your account (Kakao / Apple / Google), a turn-on for party
alerts, and "Verify your number to collect your coins" if a game's coins are
waiting.

## Analytics (privacy-safe)

`web/analytics.js` → the insert-only `events` table: a random id for this
install (not the account), the event, a few whitelisted labels / numbers, the
language. Never a location, a name, a party code or anything typed. Events:

`app_open` (source: invite_link / organic, returning), `party_link_opened`,
`joined_party`, `name_set`, `character_shuffled` (count: Randomize taps and
essential taps on the setup card), `character_confirmed`,
`first_game_started` (ms since first open, game), `first_game_finished`,
`recap_shown`, `recap_shared`, `own_party_created`, `invite_sent` (channel:
share / sms / copy / qr / contacts), `verification_prompted` /
`verification_completed` (trigger), `permission_prompted` /
`permission_granted` / `permission_declined` (permission), and (018)
`account_save_prompted` (trigger), `account_saved` / `account_signed_in`
(provider), `verification_code_sent` (trigger), `verification_failed`
(trigger, reason: rate_limited / provider / bad_code / bad_number / taken /
other). Sent vs completed vs failed by reason is how SMS delivery shows up
on the dashboard.

The dashboard, `web/stats.html`: median time from first open to first game,
% of invite opens that join, % who finish their first party, % who host
within 7 days, a count per event. Only accounts in the `admins` table can
read it (`onboarding_stats()`): insert your account's id by hand.

**Apply:** `python3 scripts/apply_migration.py supabase/migrations/017_events.sql`, then `018_account_events.sql`
(until it's applied, the app's events just aren't sent).

## The web vs. a native app

- Universal links / "open the app if installed": there's no native app;
  invite links always open the web app straight into the party. A native app
  would register `/p/*` (apple-app-site-association / assetlinks.json) and
  read the same `party` parameter; the pending-invite handoff is already
  device-side.
- iOS keeps a home-screen web app's storage apart from Safari's, so an
  invite opened in Safari and then "installed" doesn't carry over (a link
  opened inside the installed app does).
- KakaoTalk: the share sheet covers it. A one-tap "KakaoTalk" button with a
  rich card needs a Kakao JavaScript key (Kakao Developers app) and the Kakao
  SDK; easy to add once there's a key.
- Notifications: web push works on Android, and on iOS 16.4+ only for
  home-screen web apps. Delivering "a friend is throwing a party" needs a
  push service (VAPID keys + a server sender), not built yet.
- Haptics: `navigator.vibrate` on Android; iOS Safari has none.

## Testing

- `npm test`: the onboarding group in `test/specs.js` (strings in both
  languages, name suggestions, starter looks, phone numbers, the invite
  page, the analytics whitelist) and the `events` migration in
  `test/coins_sql.mjs`.
- `node test/onboard_rec.mjs <dir> [en|ko|both] [--quick]`: the real app
  page (Supabase faked), fresh phones in their own browser contexts: a
  returning player (the chip, the edit card, straight into the dive), Path
  A and Path B recorded (the setup card, its 3D / 2D toggle), every screen
  shot in both languages, a declined location, an interrupted install, a
  guest verifying mid-party, and tap → first game for 5 fresh phones
  (sizes, languages; human-paced unless `--quick`). The stub's `?verify=1`
  / `stub-verify` turns phone auth on; the code is always 123456.
- `node test/glass_shots.mjs <dir> [--prefix=before] [--only=a,b,c,d]`:
  every dialog, sheet, popup and button surface in the app, shot on the
  real page offline (the setup card, the invite sheet, Leave the party?,
  Settings, a pre-prompt, the safety card, a toast, Home, the recap,
  verification, Save your account, the game votes, the lobby, a profile
  card, End this game?, the party results, the host menu, Style, the shop,
  a beacon's card): run it before and after a change to the shared glass
  (theme.css `.glass`, `.glass-btn`, `.glass-dialog`, `.glass-sheet`…).
- `node test/auth_rec.mjs <dir> [en|ko|both]`: accounts on the real app page:
  a guest from an invite (no phone anywhere), saving with Kakao from the
  recap (same account, back in the party), a Kakao account that's taken, the
  phone prompt when going public (reason line, 30 s, Send it again, +82 010…),
  the SMS provider refusing, a new phone signing in. The stub's
  `stub-oauth=kakao,apple,google` switches providers on, `stub-oauth-taken`
  and `stub-sms-fail=provider|rate` the failures.
- `?onb=0` turns the onboarding off (the older real-page tests); `?lang=ko|en`.
- A real 5-person test (people who've never seen the app, an invite link,
  timed tap → first game, watching where they hesitate) is the next step;
  the automated runs only time the app, not people.
