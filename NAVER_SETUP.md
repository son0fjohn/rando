# Naver Cloud Platform Maps — console setup (manual, ~10 minutes)

The integration reads `NAVER_MAPS_CLIENT_ID` and `NAVER_MAPS_CLIENT_SECRET`
from `.env`. Until those exist, every Naver-backed script no-ops cleanly —
nothing in the app breaks. This file is the exact console path to get them.

## 1 · Account

1. Go to <https://www.ncloud.com> → **회원가입 / Sign up** (a Korean mobile
   number or corporate registration works; international sign-up exists but
   asks for a payment card — the Maps free tier won't charge it).
2. Log in to the **Console**: <https://console.ncloud.com>.

## 2 · Enable the Maps product

1. Console → **Services** → search "**Maps**"
   (path: *Services → Application Services → Maps*).
2. Press **이용 신청 (Subscribe/Request Use)** if it's the first time.

## 3 · Register the application (this issues the keys)

1. Console → **Application Services → Maps → Application 등록 (Register)**.
2. **App name**: `rando` (anything readable).
3. **Select APIs** — tick the ones we use:
   - **Geocoding** (address → coordinates)
   - **Reverse Geocoding** (coordinates → Korean road/legal address)
   - **Static Map** (offline ground-reference imagery)
   - *(optional)* **Dynamic Map** — only if we later embed the interactive
     JS map; not needed for the current build-time integration.
4. **Service environment / URL whitelist** — register BOTH:
   - `http://localhost:8743` (local dev preview)
   - the production origin, e.g. `https://<your-app>.vercel.app`
   (Whitelisting matters for the JS Dynamic Map; the REST APIs authenticate
   by headers, but registering the origins now saves a return trip.)
5. Save. Open the app's detail page: copy
   - **Client ID** (shown as *Application Key ID* / `X-NCP-APIGW-API-KEY-ID`)
   - **Client Secret** (*Application Key* / `X-NCP-APIGW-API-KEY`)

## 4 · Put the keys in `.env` (never committed)

Append to `E:\rando\.env` (the file is gitignored):

```
NAVER_MAPS_CLIENT_ID=your_client_id_here
NAVER_MAPS_CLIENT_SECRET=your_client_secret_here
```

## 5 · Smoke test

```
py -3 scripts/naver_maps.py --probe
```

Expected: `credentials OK — geocode("서울 용산구 이태원로 179") → lat/lng ...`
plus a usage-counter line. If you see 401/403: the app registration is
missing an API tick (step 3.3) or the keys were copied from a different app.

## VWorld key (digital-twin geometry — 5 minutes, separate from Naver)

The twin's building geometry comes from the official Korean building
registry (건물통합정보) served by the VWorld open Data API:

1. <https://www.vworld.kr> → 회원가입 (sign up) → log in.
2. 오픈API → 인증키 발급 (API key issuance) → request a key
   (service: 데이터 API; URL: `http://localhost:8743` is fine).
3. Keys are issued instantly; copy it into `.env`:

```
VWORLD_API_KEY=your_vworld_key_here
```

4. Then run, in order:

```
py -3 scripts/fetch_bldg_registry.py
py -3 scripts/bake_registry.py --dry-run   # review the reconcile stats
py -3 scripts/bake_registry.py             # write buildings.json
```

Keyless calls return `INVALID_KEY / 등록되지 않은 인증키입니다` — if you
see that after pasting a key, the key hasn't finished registering (rare,
wait a minute) or the 데이터 API service wasn't ticked.

## Free-tier ceilings (why usage logging exists)

- Static Map: 3,000,000 calls/month free
- Dynamic Map: 6,000,000 loads/month free
- Geocoding / Reverse Geocoding: generous free monthly quota under the
  same Maps subscription

Our build-time usage is a handful of calls per bake — the local counter in
`scripts/naver_usage.json` exists so drift is visible long before any
ceiling matters.
