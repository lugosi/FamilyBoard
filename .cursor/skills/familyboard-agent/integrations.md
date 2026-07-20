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
| `todos.json` | WikiLLM email-scan todos (not the GitHub wiki) |

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
- Waste: `wasteBinFull`, `wasteBinStatusLabel` from `deviceErrorList` (`garbage_tobe_full`) / `garbageStatus`
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

- `BOARD_ACCESS_CODE` + `BOARD_ACCESS_SECRET`; cookie `fb_gate`.
- Keep form in `UnlockForm.tsx` (client child of server page).

## WikiLLM + Gmail drop-box

- UI: `AppShell` → `WikiLlm.tsx` (AI tab). Knowledge: private GitHub repo only (`WIKILM_GITHUB_REPO` + `WIKILM_GITHUB_TOKEN`, optional `WIKILM_GITHUB_PATH=wiki`).
- Gemini: `GEMINI_API_KEY` / optional `GEMINI_MODEL`. Chat routes under `/api/wiki/*`.
- Google scopes include `gmail.readonly` + `gmail.modify`. Enable Gmail API; **re-link Google** after deploy.
- Flow: forward mail to linked inbox → **Scan inbox** → Gemini extracts todos → `todos.json`. No send-from-board in v1.
- Do not put wiki markdown or the GitHub PAT in `DATA_DIR` session files.
