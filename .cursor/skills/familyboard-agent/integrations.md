# FamilyBoard integrations reference

Read this when editing CatLink, Spotify, Hue, Nest, Google Calendar, Weather, or auth.

## DATA_DIR session files

`getDataDir()` → `DATA_DIR` env or `./data` (gitignored). Docker: mount `/data`.

| File | Integration |
|------|-------------|
| `google-tokens.json` | Google Calendar + Nest + Gmail OAuth |
| `spotify-tokens.json` | Spotify OAuth |
| `hue.json` | Hue bridge username |
| `catlink-session.json` | CatLink token, phone, phoneIac, apiBase |
| `petlibro-session.json` | Petlibro email, password, token, region, apiBase |
| `cat-diet-history.json` | Rolling ~180 local days of cat weight + food + water |
| `board-widget-layout.json` | Board widget order + enabled flags (Arrange / expand-all overlay) |
| `nest-climate-history.json` | Indoor climate samples |
| `todos.json` | Legacy local todos only when wiki is not configured; with wiki, tasks live in `todos/list.md` |
| `chat-conversations.json` | Slack bot short-term memory per DM / channel thread (30 min TTL) |
| `agent-chat-sessions.json` | Board/AI web chat sessions (multi-conversation history; not wiki) |
| `strava-accounts.json` | Per-person Strava OAuth tokens (`board:<member>` / `slack:<userId>`) |
| `strava-activity-cache.json` | Per-person Strava activity cache (bootstrap last 30 days, then incremental `after` diff; pruned to rolling 30d) |

## CatLink (`src/lib/catlink.ts`, `catlink-crypto.ts`)

### Auth
- Password login only (`login/password` + `login/password/v2`); SMS/Geetest not supported.
- `parsePhoneInput()` — national number only; `+1 424…` → iac `1`, mobile `424…`.
- Password max **16** characters.
- Region walk: env `CATLINK_API_BASE` then USA → global → China → Singapore; persist winning `apiBase`.
- Token expired `returnCode === 1002` → re-login if password available.
- Wrong password `2002`. Only one cloud session — stay logged out of the phone app while linking.

### Device classification
`classifyDevice()` → `scooper` | `litterbox` | `c08`.

Treat as **litterbox** when:
- `deviceType` is `LITTER_BOX_599` or contains `LITTER`
- model contains `SE`, `BAYMAX`, or `599`

`fetchDeviceInfo` tries primary kind then falls back across kinds until `deviceInfo` is non-empty.

### Actions (Scooper SE)

| UI | Action | API |
|----|--------|-----|
| Clean | `clean_now` | `token/litterbox/actionCmd` `cmd: "01"` (c08 uses v3 RUN/CLEAN) |
| Refill | `refill_litter` | `token/litterbox/actionCmd/v3` RUN/`PAVE` (SE + C08 Add/Empty). Classic scooper: `token/device/actionCmd` `cmd: "02"` |
| Change bag | `change_bag` | `replaceGarbageBagCmd` `enable: "1"` |
| Reset | `reset_bin` | **same** `replaceGarbageBagCmd` `enable: "0"` |

**Wrong:** litterbox `actionCmd` `cmd: "02"` for Refill (SE only has Cleaning `01` / Pause `00` on that endpoint).  
**Wrong:** `token/device/union/consumableReset` for the Reset button (that resets litter *counter*, not the waste bin).

### Snapshot fields (current product intent)
- Pet: `catName`, `catWeightKg`, `peeCountToday`, `poopCountToday` from `token/pet/health/v3/cats` + `summarySimple` (`toilet.peed` / `toilet.pood`)
- Waste: `wasteBinFull`, `wasteBinStatusLabel` from `deviceErrorList` (`garbage_tobe_full`) / `garbageStatus`. Board shows a red blinking beacon + ring while full (and skips night greyscale so the alert stays vivid) until Change bag / Reset clears it.
- Timezone for pet summaries: `DEFAULT_TIMEZONE` (fallback `America/Los_Angeles`)

### Routes
- `GET /api/catlink` → snapshot
- `POST /api/catlink/control` `{ action }`
- `POST /api/catlink/auth/link` / `unlink`

Env: `CATLINK_PHONE`, `CATLINK_PASSWORD`, `CATLINK_PHONE_IAC`, `CATLINK_API_BASE`, optional `CATLINK_DEVICE_ID`.

## Petlibro (`src/lib/petlibro.ts`)

Unofficial cloud API (same as HA `jjjonesjr33/petlibro`): email + **MD5** password → `token` header.

### Auth gotchas
- Account must be created in the **Petlibro mobile app** with email/password. Google Sign-In and website-only signups fail (`MEMBER_NOT_EXIST` / no password).
- Prefer a second shared account (share devices from the primary) so the phone app keeps its session.
- Password max **18** characters. Region defaults to `US`; API base `https://api.us.petlibro.com` (EU app accounts usually still work on the US host).
- Token expired `code === 1009` → re-login with stored password.

### Snapshot fields
- Feeders (`PLAF*`): `grainStatus.todayFeedingQuantity` (portions) → cups/oz/g/ml via `unitType`; feed times; food-low from `surplusGrain`
- Fountains (`PLWF*`): `todayDrinkData.todayTotalMl` / `todayTotalTimes`; reservoir `%` from `realInfo.weightPercent`
- History: board/agent fetches + hourly background sync upsert `DATA_DIR/cat-diet-history.json` (**~180 local days**; CatLink weight/toilet when linked)
- Cloud backfill: water via `POST /data/deviceDrinkWater/history` (`dimension: month`, up to **6 months** / ~170 days retained); food via `workRecord/list` (~90 days); CatLink weight via `summarySimple?date=` (up to **90** past days). Live `todayDrinkData` is still only today+yesterday.
- Agent tool: `petlibro_consumption` returns today + `history` averages/deltas + food/water (and weight) charts (weekly avg when series is long)

### Routes
- `GET /api/petlibro` → snapshot
- `POST /api/petlibro/auth/link` / `unlink`

Env: `PETLIBRO_EMAIL`, `PETLIBRO_PASSWORD`, optional `PETLIBRO_REGION`, `PETLIBRO_API_BASE`.

## Weather (`src/lib/weather.ts`)

- Open-Meteo; `WEATHER_LAT` / `WEATHER_LON`; optional `WEATHER_TIMEZONE`.
- Retries transient upstream failures; optional `WEATHER_API_BASE_URL` / `WEATHER_GEOCODING_API_BASE_URL` for mocks.
- CI sets `WEATHER_FIXTURE=1` for a canned snapshot (no live Open-Meteo). Leave unset on TrueNAS.
- Upstream fetch failures → **502** from `/api/weather`.
- `hourlyNext18` rolling from current hour; `sunByDate` for per-day sunrise/sunset.
- Board widget: `WeatherDayParts` (morning/afternoon/night) + `WeatherDailyStrip` (precip % from Open-Meteo).
- Greyscale vs icon night: see SKILL.md table.

## Google Calendar (`src/lib/google.ts`, `calendar-layout.ts`)

- Scopes include calendar + Nest SDM when Nest is used.
- Prefer calendar named **berkeley** when user has not explicitly chosen.
- Week starts Monday; default 3-week home range auto-advances.
- All-day bars: `layoutAllDayBarsForWeek` / `clipAllDayBarToWeek`.

## Spotify (`src/lib/spotify.ts`)

- OAuth + Web Playback SDK (`streaming` scope) — re-link if scopes change.
- Snapshot: now-playing + devices; control: play/pause/next/seek/volume/transfer.
- Board: known-device map; green tint (`#1DB954`) when `is_playing`.

## Hue (`src/lib/hue.ts`)

- LAN to bridge; pair via `/api/hue/pair` (press bridge button).
- Themes: `bright | relax | focus | nightlight`.
- Persist username in `hue.json`; needs `HUE_BRIDGE_IP`.
- Agent tools (when paired): `list_lights`, `control_lights` (room name match via `squashHueAreaName`). Also Spotify `spotify_control` and CatLink `catlink_control` when those integrations are ready (`src/lib/agent-device-tools.ts`).

## Nest (`src/lib/nest-sdm.ts`, `nest-climate-history.ts`)

- Same Google OAuth client; needs Device Access **enterprise** project id + PCM authorize (`/api/auth/nest/pcm`).
- `invalid_grant` → clear tokens, ask user to re-link.
- Indoor charts: `IndoorClimateCharts.tsx`.

## Status codes (Board expectations)

| Code | Meaning in UI |
|------|----------------|
| 501 | Feature not configured — show setup copy |
| 401 | Need link / unlock |
| 502 | Upstream failed — surface `error` message |

## Unlock gate

- `BOARD_ACCESS_CODE` + `BOARD_ACCESS_SECRET`; cookie `fb_gate` is a random per-unlock token (hash in `DATA_DIR/gate-sessions.json`). Rotating the secret clears sessions.
- Keep form in `UnlockForm.tsx` (client child of server page). `src/proxy.ts` validates via `isValidGateSession`.

## WikiLLM + Gmail drop-box

- UI: `AppShell` → `WikiLlm.tsx` (AI tab). Knowledge: private GitHub repo (`WIKILM_GITHUB_TOKEN` required; repo defaults to `lugosi/family-wiki`, optional `WIKILM_GITHUB_PATH=wiki`).
- Gemini: `GEMINI_API_KEY` / optional `GEMINI_MODEL` (default `gemini-3.5-flash-lite`; the board Settings widget choice wins over the env var) / optional `GEMINI_THINKING_LEVEL`. Chat routes under `/api/agent/*`.
- Google scopes include `gmail.readonly` + `gmail.modify`. Enable Gmail API; **re-link Google** after deploy.
- Flow: forward mail to linked inbox → **Scan inbox** (button, agent `scan_inbox`, or `GMAIL_AUTO_SCAN_MINUTES`) → Gemini extracts todos + events → `todos.json` + Google Calendar. No send-from-board in v1.
- Do not put wiki markdown or the GitHub PAT in `DATA_DIR` session files.
- Wiki reads: one `git/trees/{branch}?recursive=1` call per minute (cache) + `git/blobs/{sha}` only for changed files (blob cache keyed by sha). Edits read fresh via `contents/` and write with that `sha`; GitHub answers 409 (or 422 when a create hits an existing file) → `WikiError("conflict" | "exists")`. Contents **404** on create/update usually means token/repo access (not “file missing”) — `putFile` diagnoses via `GET /repos/...`. Empty repos seed the first commit via the Git Data API (Contents cannot create file #1).
- When `WIKILM_GITHUB_BRANCH` is unset, resolve the repo `default_branch` once and cache it.
- Paths in tools, API, and UI are relative to `WIKILM_GITHUB_PATH` (`people/maya.md`). New pages and move targets are slugified; existing paths keep their case. `..`, dot-folders, and >3 levels are rejected.
- `WIKILM_GITHUB_API_BASE_URL` override exists for local mocks only.

## Slack bot (`src/lib/slack.ts`, `src/lib/slack-bot.ts`)

- Socket Mode: `apps.connections.open` (app token `xapp-`, `connections:write`) → WebSocket (Node 22 global `WebSocket`, no SDK). Ack every envelope with `{ envelope_id }` immediately; Slack retries un-acked events, so dedupe on `event_id`.
- On `disconnect` frames (Slack refreshes sockets every few hours) close and reconnect; backoff up to 60s on failures.
- Events: `message.im` (DMs, skip any `subtype` / `bot_id` / own user) and `app_mention` (reply in `thread_ts ?? ts`). Memory key is the DM user or the channel thread; thread turns are prefixed with the speaker's name.
- Reply text is Slack mrkdwn (agent channel `"slack"`); changed-state actions are appended as ✅ lines. 👀 reaction while working.
- Starts in `src/instrumentation.ts`; state on `globalThis` so `GET /api/slack` (501 unconfigured, 502 bad token) can read it.
- Workspace-open by design (family workspace). Do not add a public Events API endpoint; Socket Mode keeps the board unexposed.
- `SLACK_API_BASE_URL` override exists for local mocks only.
