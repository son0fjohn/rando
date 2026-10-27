# Onboarding: first open → playing with friends in under a minute

One goal: someone opens Rando (usually from a friend's invite) and is in a
game with that friend within ~60 seconds. Code: `web/onboard.js` (the
screens), `web/onbkit.js` (the pure parts), `web/i18n.js` (English and
Korean), `web/permissions.js` (pre-prompts), `web/analytics.js` +
`supabase/migrations/017_events.sql` (events), `api/invite.mjs` (the invite
link's preview), `web/stats.html` (the dashboard).

## Path A: an invite link (the main path)

1. The host's invite is `https://randoirl.vercel.app/p/CODE?n=<party name>&c=<people>`.
   `api/invite.mjs` (a Vercel function; `vercel.json` rewrites `/p/:code`)
   answers with the night-sky OG card and the title "Jae's party · 4 inside"
   (Korean phones: "Jae's party · 4명 참여 중"), then sends the browser to
   `/?party=CODE&from=invite`. Parties live in no table, so the name and the
   count ride in the link (the count as it was when shared).
2. The landing: the party room's backdrop with the people inside (the host
   first, crowned), the party's name, who's hosting and how many are in, one
   gold "Join the party". It peeks into the party without joining it
   (`net.js` `peekRoom`: the host answers with the name, the members and
   their looks, what's playing); the room's backdrop and the people's
   characters load while they look.
3. Join → the name (one field, a 🎲 suggestion) → the character (a random
   starter outfit with a random skin, hair and eyes, spinning on a
   platform; Shuffle / This is me; "customize later in Style") → straight
   into the room: "You're in!", everyone already there waves.
4. A game already running: the landing says so, and the room line says
   "<game> is on — you're in the next one".
5. The code is kept on the phone (12 h) until they're in, so a reload, a
   sign-in or an interrupted install that reopens the app comes back to the
   same landing.

## Path B: opening the app on your own

Two intro screens over the night city slowly turning (a first open is
always night, `__RANDO_FIRST_NIGHT`), skippable → name → character → Home.

**Home** (every later open lands here too): your character, Throw a party
(gold), See what's happening nearby, join with a code, friends' public
parties, what's new (tap to dismiss), EN / 한 and Settings. Throw a party
creates an invite-only party at once and opens the invite sheet: Share link
(the phone's share sheet: KakaoTalk, iMessage, Instagram…), Messages, Copy
link, Invite from contacts (where the Contact Picker exists: Android Chrome),
and the QR code (tap it to show it big). Alone in your own room: "Invite your
friends: games work best with 3+" with the QR, big. The map has a Home
button (top left).

## Verification only when it matters

Guests join and play with nothing but a name. Phone verification is asked at
the moment it's needed, with a one-line reason: public parties (making one,
joining one from the map or a friend's), adding friends (the in-person "We
met" confirm), spending coins, and Settings → Save my progress. Hosting a
private party (invite link / code) never asks.
A guest (anonymous account) gets the number linked to the same account
(`updateUser({ phone })` + `verifyOtp(type: "phone_change")`), so the
character, coins and friends stay and they carry on where they were; another
phone signs in with the number (Settings). Korean numbers can be typed the
local way (010-…).

**Setup:** the gates switch themselves on only when the Supabase project has
an SMS provider (`/auth/v1/settings` → `external.phone`); until then nothing
is gated. To turn it on: Supabase → Authentication → Providers → Phone, with
an SMS provider (Twilio, MessageBird, Vonage…). Korean 본인인증 (PASS / NICE)
would be a server integration later.

## Permissions at their moment

Never on the first screen. Each gets a pre-prompt card before the system's
own dialog, and "Not now" always works (a note says Settings can turn it on):

| | When | Pre-prompt |
| --- | --- | --- |
| Location | Home → "nearby", the Explore tab (going visible), Manhunt's "I'm in" | "See parties happening nearby. We only show your area, never your exact spot." |
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
- The first time a phone plays a game, that game's host says what to do in
  one or two lines (the dialog box, near the top): The Prophet, The Boss,
  Bunny, The Hunter; The Diary and The Table for the hostless games.
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
sheet), and a turn-on for party alerts and a verify-to-keep-your-coins.

## Analytics (privacy-safe)

`web/analytics.js` → the insert-only `events` table: a random id for this
install (not the account), the event, a few whitelisted labels / numbers, the
language. Never a location, a name, a party code or anything typed. Events:

`app_open` (source: invite_link / organic, returning), `party_link_opened`,
`joined_party`, `name_set`, `character_shuffled` (count), `character_confirmed`,
`first_game_started` (ms since first open, game), `first_game_finished`,
`recap_shown`, `recap_shared`, `own_party_created`, `invite_sent` (channel:
share / sms / copy / qr / contacts), `verification_prompted` /
`verification_completed` (trigger), `permission_prompted` /
`permission_granted` / `permission_declined` (permission).

The dashboard, `web/stats.html`: median time from first open to first game,
% of invite opens that join, % who finish their first party, % who host
within 7 days, a count per event. Only accounts in the `admins` table can
read it (`onboarding_stats()`): insert your account's id by hand.

**Apply:** `python3 scripts/apply_migration.py supabase/migrations/017_events.sql`
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
  page (Supabase faked), fresh phones in their own browser contexts: Path A
  and Path B recorded, every screen shot in both languages, a declined
  location, an interrupted install, a guest verifying mid-party, and tap →
  first game for 5 fresh phones (sizes, languages; human-paced unless
  `--quick`). The stub's `?verify=1` / `stub-verify` turns phone auth on; the
  code is always 123456.
- `?onb=0` turns the onboarding off (the older real-page tests); `?lang=ko|en`.
- A real 5-person test (people who've never seen the app, an invite link,
  timed tap → first game, watching where they hesitate) is the next step;
  the automated runs only time the app, not people.
