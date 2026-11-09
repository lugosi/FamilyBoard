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
| `nest-climate-history.json` | Indoor climate samples |
| `todos.json` | Legacy local todos only when wiki is not configured; with wiki, tasks live in `todos/list.md` |
| `chat-conversations.json` | Slack bot short-term memory per DM / channel thread (30 min TTL) |
| `agent-chat-sessions.json` | Board/AI web chat sessions (multi-conversation history; not wiki) |

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

## Weather (`src/lib/weather.ts`)

- Open-Meteo; `WEATHER_LAT` / `WEATHER_LON`; optional `WEATHER_TIMEZONE`.
- `hourlyNext18` rolling from current hour; `sunByDate` for per-day sunrise/sunset.
- Chart: `WeatherHourlyChart.tsx` — `smoothLinePath`, icon only on condition change via `weatherIconKey`.
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
- Gemini: `GEMINI_API_KEY` / optional `GEMINI_MODEL`. Chat routes under `/api/wiki/*`.
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
