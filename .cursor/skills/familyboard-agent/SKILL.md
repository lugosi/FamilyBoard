---
name: familyboard-agent
description: >-
  FamilyBoard home-dashboard coding agent. Use when editing FamilyBoard widgets,
  Board.tsx, AppShell, WikiLLM, calendar, weather, CatLink, Spotify, Hue, Nest,
  Google Calendar/Gmail, API routes under src/app/api, or src/lib integrations.
  Encodes Next.js 16 quirks, snapshot/control patterns, DATA_DIR sessions, and
  hard-won device UX lessons.
---

# FamilyBoard coding agent

You are working on **FamilyBoard**: a Next.js 16 family dashboard (calendar + right-column widgets). Prefer matching existing patterns over inventing new ones.

## Before any code

1. Read `AGENTS.md` — this is **not** classic Next.js. Check `node_modules/next/dist/docs/` for APIs.
2. Dynamic route params are async: `ctx: { params: Promise<{ id: string }> }` then `await ctx.params`.
3. Request gate is `src/proxy.ts` (`export async function proxy`), not `middleware.ts`.
4. Verify with `npm run build` after non-trivial changes.

## Architecture (do not reinvent)

| Concern | Pattern |
|---------|---------|
| UI | Almost all dashboard UX lives in `src/components/Board.tsx` (AppShell tabs: Board / AI) |
| Settings widget | `board-settings.ts` (client-safe: model list, themes, normalize) + `board-settings-store.ts` (`DATA_DIR/board-settings.json`) + `GET/PUT /api/settings`; `useBoardSettings` + `BoardSettingsWidget`. Night mode toggle only gates the greyscale (`isNightGreyscaleActive`), not weather-icon night. Themes are `html[data-theme]` slate/sky variable overrides in `globals.css` (root layout reads the theme server-side to avoid a flash) |
| Widget layout | `board-widget-layout.ts` + `GET/PUT /api/board/widgets` — order + enabled; Arrange on column + expanded view; expand all via divider (desktop) / top control (mobile) over calendar |
| Logic | `src/lib/<integration>.ts` |
| HTTP | Thin `src/app/api/**/route.ts` |
| Secrets / tokens | Files under `getDataDir()` (`DATA_DIR` or `./data`) |
| Config flags | Aggregated in `GET /api/auth/status` |

**Snapshot vs control** for device integrations:

- Read: `GET /api/<name>` → `fetch*Snapshot()`
- Write: `POST /api/<name>/control` with `{ action }`
- Missing config → **501**; upstream failure → **502**; auth → **401**

Document new env vars in `.env.example`. OAuth redirects use `PUBLIC_APP_URL` via `src/lib/app-url.ts`.

## Board widget checklist

When adding or changing a right-column widget:

1. `<section className="rounded-xl border border-slate-800 bg-slate-900/60 …">`
2. Title row + optional collapsed icon (`WIDGET_TITLE_ICON`)
3. Refresh → `void fetchBoard()`; collapse → `toggleWidgetCollapse(key)`
4. Body: collapsed → null; not configured → setup copy; else live UI
5. Mutations use `busy` string keys (`"catlink-clean_now"`); disable + “Working…”; then `fetchBoard()`
6. Register key on `BOARD_WIDGET_KEYS` / `BOARD_WIDGET_META` in `board-widget-layout.ts`, `collapsedWidgets` defaults, and `widgetNodes` map
7. Wire fetch into `fetchBoard` (respect `AbortSignal`, 60s poll)

Design: slate-dark, dense home-display type, tabular nums. Widgets are interaction panels — keep chrome consistent with neighbors.

## Night mode (two different rules)

| Feature | Helper | Rule |
|---------|--------|------|
| Board greyscale | `isNightGreyscaleActive` / `isNightAt` | Starts at **max(sunset, 10pm)**; ends **min(sunrise, 7am)** |
| Weather icons | `isNightForWeatherIcon` / `isNightForWeatherIconAt` | True **sunset → sunrise** (use `sunByDate` for hourly) |

Never conflate these.

## Calendar

- Weeks start **Monday** (`startOfWeekMonday` in `src/lib/calendar-layout.ts`)
- Default home view: `DEFAULT_HOME_CALENDAR_WEEKS = 3` via `defaultCalendarRangeKeys`
- Auto-advance current week when still on default weeks range (60s + visibility)
- Range keys are local `YYYY-MM-DD`; API `to` is exclusive via `rangeKeysToIso`

## Weather

- Compact board widget: temp + condition + H/L/rain, `WeatherDayParts` (Morning/Afternoon/Night); no multi-day strip (the calendar already shows daily weather)
- `summarizeWeatherDayParts(hourlyNext18)` collapses hours into day parts; daily/hourly include optional `precipChance`
- Legacy chart: `WeatherHourlyChart` still available
- Open-Meteo, no API key; needs `WEATHER_LAT` / `WEATHER_LON`
- Daily calendar icons use `representativeDaytimeWeatherCode` (daytime hours), not Open-Meteo’s 24h max `weather_code` (overnight skew)

## Integration hard rules

Read [integrations.md](integrations.md) before touching CatLink, Petlibro, Spotify, Hue, Nest, Google, or WikiLLM.

## WikiLLM (AI tab)

- Shell: `AppShell` tabs **Board** | **AI** (`?tab=ai`). Legacy `?tab=widgets` maps to Board. Do not fold AI UI into `Board.tsx`. Board may open the same `WikiLlm` as an overlay via AppShell nav **Ask** — still no WikiLlm import in `Board.tsx`. There is **no** floating bottom-right robot FAB (removed); entry points are the AI tab and Board nav Ask.
- Web chat sessions persist in `DATA_DIR/agent-chat-sessions.json` (`/api/agent/sessions`). Do **not** store transcripts in the GitHub wiki (wiki = curated knowledge only).
- AI tab is **one prompt** → `POST /api/agent/chat` → `runFamilyAgent` in `src/lib/agent.ts` (Gemini function calling). Add capabilities as tools there, not as new panels.
- **Mid-turn steer (web):** While the assistant is thinking, the prompt stays editable. Sending again (Enter / **Add**) merges the new text into the in-flight user turn, **aborts** the current `POST /api/agent/chat`, and retries once with the combined prompt — one model reply, not parallel turns. Status shows “Folding that into the reply…”. **Stop** / Escape cancels and restores the combined draft into the input. Do not spawn a second concurrent agent run from the web UI.
- Chat charts: tools return `charts`; agent always injects the same ` ```chart ` fences into `reply` (channel inferred). Prefer `combo` (bars + line) with `leftAxisLabel` / `rightAxisLabel` / `xAxisLabel`. AI tab: SVG via `renderChatChartSvg`. Slack: PNG upload (`files:write`) via `renderChatChartPng` + `uploadSlackFile` — needs bundled `public/fonts/DejaVuSans*.ttf` (Alpine has no system fonts; without them PNGs show bars/lines but blank labels).
- **Channel is inferred** at the entrypoint (`/api/agent/chat` → `board`, Slack bot → `slack`). Do not make the model or user pass channel on every turn.
- **Strava** is first-party per-user OAuth (`src/lib/strava.ts`, tools in `agent-strava-tools.ts`), not Strava’s official MCP (that’s for Claude/Cursor clients). Slack uses `slack:<userId>`; Board uses a member name → `board:<slug>` (AI Tools → Strava). Activity cache in `DATA_DIR/strava-activity-cache.json`: first sync pulls 30 days, later syncs only `after` the watermark; `strava_training_summary` synthesizes totals + Monday `byWeek` buckets. Built-in training skill is injected when Strava is configured; wiki page `skills/strava-training.md` is **auto-seeded** when wiki+Strava are both configured (`ensureStravaTrainingWikiSkill` — never overwrites).
- **Shopping lists:** built-in `skills/shopping-lists.md` (always injected) + wiki auto-seed via `ensureShoppingListsWikiSkill` when the wiki is configured. `add_todo` accepts `url` + `shopping`; when shopping and no URL, returns `suggestedAmazonSearchUrl` + quick-action chips; `update_todo` attaches the link. Local retail near Santa Monica CA uses `search_web` / `fetch_url`. Template: `docs/wiki-skills/shopping-lists.md`.
- House overview: `house_dashboard` tool (`src/lib/house-dashboard.ts`) works from the AI tab chip **"House dashboard"** and Slack ("how's the house"). Returns panels + `quickActions` (web: tappable chips; Slack: reply-with list).
- Tools: calendar `find_events` / `create_event` / `update_event` / `delete_event` / `list_calendars` (via `src/lib/calendar.ts`), todos (`src/lib/todos.ts` → wiki `todos/list.md` when configured, else `DATA_DIR/todos.json`; optional `url` on items), `scan_inbox`, `search_web`, `fetch_url` (SSRF-safe public URL → text for gym schedules / ICS / PDFs / static pages; `src/lib/fetch-url.ts` + `unpdf` via `src/lib/pdf-text.ts`), and wiki tools (`src/lib/agent-wiki-tools.ts`). Chat + Slack uploads accept PDFs (text extraction via `fileToAttachment`). Prefer `unpdf` over `pdf-parse` (the latter pulls `@napi-rs/canvas` and breaks Next standalone with DOM errors). Calendar + inbox tools only when Google is linked; wiki tools only when GitHub is configured. Prefer `fetch_url` over `search_web` when a skill already has a concrete URL.
- **Write approval:** calendar + wiki mutations are staged (`src/lib/agent-pending-writes.ts`) until the family taps **Approve** / **Deny** in chat (`POST /api/agent/approve`) or uses the same buttons (or `approve`/`deny` text) in Slack. Exception: writes under `.context/<SlackUserId>/` apply immediately (silent Slack continuity). Reads and todos still run immediately.
- Agent times are local wall-clock in `DEFAULT_TIMEZONE` with no offset; `src/lib/calendar.ts` attaches `timeZone`. Never hand the model UTC. New events default via `resolveDefaultCalendarId` (`GOOGLE_CALENDAR_ID`, else "berkeley", else primary) so they match the board.
- Gemini tool loops must pass model parts back verbatim (Gemini 4 `thoughtSignature`). Use `generateGeminiContent`, not `generateGeminiText`, for tools. Default model is `gemini-3.5-flash-lite`; resolve it with `resolveGeminiModel()` (Settings widget → `GEMINI_MODEL` → default), never read `GEMINI_MODEL` directly. Hydrogen-only request fields (`prefixMismatchBehavior`) are gated on `gemini-4*` ids.
- Knowledge base: **private GitHub markdown only** (`WIKILM_GITHUB_*`) via `src/lib/wikilm-github.ts`. Never store wiki pages in `DATA_DIR`. Layout + template: `docs/WIKI.md`.
  - Prompt gets an **index** (`buildWikiIndex`, 12k chars), never page bodies; the model calls `search_wiki` / `read_wiki_page`.
  - Writes: `edit_wiki_section` (server-side append/replace on the latest version), `create_wiki_page` (template, refuses near-duplicates), `rewrite_wiki_page` (only after `read_wiki_page` in the same request; sha-checked), `move_wiki_page`, `delete_wiki_page`. Every write is a GitHub contents PUT/DELETE with the file `sha` → 409 on conflict.
  - Pure parsing/editing/search lives in `src/lib/wiki-format.ts` (no imports) with tests: `npm test`.
  - The AI tab has a **Chat | Wiki** switch (`WikiBrowser.tsx`): browse/search/edit/move/delete. It is the one deliberate exception to "tools, not panels". **Tools** (scheduled checks, inbox, Strava, Slack) opens as a full main pane under the Sessions rail (replaces chat), not a cramped side drawer.
- Gmail drop-box: `scan_to_todos` / `scan` → todos (`DATA_DIR/todos.json`) **and** calendar events (tagged `extendedProperties.private.familyboardGmailId`), then `FamilyBoard/Processed` label. Optional `GMAIL_AUTO_SCAN_MINUTES`.
- Slack: same agent via Socket Mode (`src/lib/slack.ts`, `slack-bot.ts`), started from `src/instrumentation.ts`. Answers DMs and channel @mentions (thread replies); open to the whole workspace. Setup + manifest: `docs/SLACK_SETUP.md`.
- **Slack personal context (A.5 POC):** short chat memory (`chat-memory.ts`, ~30 min / 12 turns) plus durable `.context/<SlackUserId>/` wiki folders (`src/lib/personal-context.ts`). Hidden from Wiki browser / family index; Slack turns inject a personal **index** (fresh vs stale facts); model `read_wiki_page`s matching files; context writes skip Approve. **Write-back is mandatory** for any durable topic (hikes, trips, work, pets, prefs, open plans) — not only when they say “remember”. Default `open-loops.md`; create topic pages (`hike`, `travel`, `work`, …) under `.context/` as needed; seeded `pets.md` / `strava.md` when relevant. Facts: `- text · created: YYYY-MM-DD · updated: YYYY-MM-DD · weight: N` — TTL = 30×weight days. Optional join via `people/*.md` `slack: U…`. Shared wiki — not private; Layer B personal GitHub later.
- **Morning brief:** built-in Scheduled check (`kind: morning-brief`, id `morning-brief`) seeded from `DATA_DIR/daily-brief.json`. Editable in AI → Tools → Scheduled checks (time, notes, web chat, Slack recipients). Runs via `tickAgentMonitors` → deterministic gather in `src/lib/daily-brief.ts` (calendar / weather / todos / house). Slack users auto-register on DM; `morning on` / `morning off`. Recipient picker uses wiki `people/*.md` frontmatter `slack: U…` plus registered subscribers. Legacy `GET/POST /api/daily-brief` still works; `tickDailyBrief` is a no-op to avoid double-sends. Env: `DAILY_BRIEF_*` in `.env.example`.
- **Scheduled checks (agent monitors):** `tickAgentMonitors` (`src/lib/agent-monitors.ts`). Tools UI presets (7:00 morning, every morning, weekdays, …); stored as 5-field cron. Agent prompts + persistent chat sessions and/or Slack DMs (`slackUserIds` per monitor; empty → all registered). Store in `DATA_DIR/agent-monitors.json`. `GET/POST /api/agent/monitors` (+ `[id]` PATCH/DELETE/run). Kill-switch: `AGENT_MONITORS_ENABLED`. Presets + cron helpers in `src/lib/cron.ts`.
- Re-link Google after enabling Gmail API / new OAuth scopes.

**CatLink (highest footgun density):**

- Scooper SE / `LITTER_BOX_599` → **`litterbox`** APIs, not classic `token/device/*`
- Buttons match the app: Clean, Refill, Change bag, Reset — not child-lock/odor/light
- Change bag: `replaceGarbageBagCmd` `enable: "1"`; **Reset: same endpoint `enable: "0"`** (not `consumableReset`)
- Stats: cat weight + pee + poop from pet health APIs; waste bin from `garbage_tobe_full`
- Phone: `parsePhoneInput()` strips country code; password ≤ 16 chars; password login only

## Workflow for new features

```
1. Find the closest existing widget/integration and copy its shape
2. Put cloud/device logic in src/lib; keep route.ts thin
3. Expose configured/linked on /api/auth/status
4. Add Board UI with collapse + busy + fetchBoard
5. Update .env.example
6. npm run build
```

## Anti-patterns

- Inventing a CatLink companion proxy (`CATLINK_API_BASE_URL`) — talk to CatLink cloud directly
- Sunday week starts
- Using greyscale night timing for weather moon icons
- Putting tokens in env instead of `DATA_DIR` session files (except bootstrap secrets)
- Expanding `Board.tsx` with one-off styles that break the slate widget chrome
- Committing without being asked; pushing without being asked
