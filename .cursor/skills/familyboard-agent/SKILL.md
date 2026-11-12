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
| UI | Almost all dashboard UX lives in `src/components/Board.tsx` |
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
6. Register key on `RightWidgetKey` and `collapsedWidgets` defaults
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

- `HOURLY_FORECAST_HOURS = 18` → `hourlyNext18`
- Chart: `WeatherHourlyChart` — smooth cubic path (`smoothLinePath`), high/low labels
- Show weather icon only when `weatherIconKey(code, isNight)` changes vs previous hour
- Open-Meteo, no API key; needs `WEATHER_LAT` / `WEATHER_LON`
- Daily calendar icons use `representativeDaytimeWeatherCode` (daytime hours), not Open-Meteo’s 24h max `weather_code` (overnight skew)

## Integration hard rules

Read [integrations.md](integrations.md) before touching CatLink, Spotify, Hue, Nest, Google, or WikiLLM.

## WikiLLM (AI tab)

- Shell: `AppShell` tabs **Board** | **AI** (`?tab=ai`). Do not fold AI UI into `Board.tsx`. Board may open the same `WikiLlm` as an overlay via AppShell (robot / Ask) — still no WikiLlm import in `Board.tsx`.
- Web chat sessions persist in `DATA_DIR/agent-chat-sessions.json` (`/api/agent/sessions`). Do **not** store transcripts in the GitHub wiki (wiki = curated knowledge only).
- AI tab is **one prompt** → `POST /api/agent/chat` → `runFamilyAgent` in `src/lib/agent.ts` (Gemini function calling). Add capabilities as tools there, not as new panels.
- Chat charts: tools return `charts`; agent always injects the same ` ```chart ` fences into `reply` (channel inferred). Prefer `combo` (bars + line) with `leftAxisLabel` / `rightAxisLabel` / `xAxisLabel`. AI tab: SVG via `renderChatChartSvg`. Slack: PNG upload (`files:write`) via `renderChatChartPng` + `uploadSlackFile`.
- **Channel is inferred** at the entrypoint (`/api/agent/chat` → `board`, Slack bot → `slack`). Do not make the model or user pass channel on every turn.
- **Strava** is first-party per-user OAuth (`src/lib/strava.ts`, tools in `agent-strava-tools.ts`), not Strava’s official MCP (that’s for Claude/Cursor clients). Slack uses `slack:<userId>`; Board uses a member name → `board:<slug>` (AI Tools → Strava). Activity cache in `DATA_DIR/strava-activity-cache.json`: first sync pulls 30 days, later syncs only `after` the watermark; `strava_training_summary` synthesizes totals + Monday `byWeek` buckets. Built-in training skill is injected when Strava is configured; wiki page `skills/strava-training.md` is **auto-seeded** when wiki+Strava are both configured (`ensureStravaTrainingWikiSkill` — never overwrites).
- House overview: `house_dashboard` tool (`src/lib/house-dashboard.ts`) works from the AI tab chip **"House dashboard"** and Slack ("how's the house"). Returns panels + `quickActions` (web: tappable chips; Slack: reply-with list).
- Tools: calendar `find_events` / `create_event` / `update_event` / `delete_event` / `list_calendars` (via `src/lib/calendar.ts`), todos (`src/lib/todos.ts` → wiki `todos/list.md` when configured, else `DATA_DIR/todos.json`), `scan_inbox`, and wiki tools (`src/lib/agent-wiki-tools.ts`). Calendar + inbox tools only when Google is linked; wiki tools only when GitHub is configured.
- **Write approval:** calendar + wiki mutations are staged (`src/lib/agent-pending-writes.ts`) until the family taps **Approve** / **Deny** in chat (`POST /api/agent/approve`) or uses the same buttons (or `approve`/`deny` text) in Slack. Reads and todos still run immediately.
- Agent times are local wall-clock in `DEFAULT_TIMEZONE` with no offset; `src/lib/calendar.ts` attaches `timeZone`. Never hand the model UTC. New events default via `resolveDefaultCalendarId` (`GOOGLE_CALENDAR_ID`, else "berkeley", else primary) so they match the board.
- Gemini tool loops must pass model parts back verbatim (Gemini 3 `thoughtSignature`). Use `generateGeminiContent`, not `generateGeminiText`, for tools.
- Knowledge base: **private GitHub markdown only** (`WIKILM_GITHUB_*`) via `src/lib/wikilm-github.ts`. Never store wiki pages in `DATA_DIR`. Layout + template: `docs/WIKI.md`.
  - Prompt gets an **index** (`buildWikiIndex`, 12k chars), never page bodies; the model calls `search_wiki` / `read_wiki_page`.
  - Writes: `edit_wiki_section` (server-side append/replace on the latest version), `create_wiki_page` (template, refuses near-duplicates), `rewrite_wiki_page` (only after `read_wiki_page` in the same request; sha-checked), `move_wiki_page`, `delete_wiki_page`. Every write is a GitHub contents PUT/DELETE with the file `sha` → 409 on conflict.
  - Pure parsing/editing/search lives in `src/lib/wiki-format.ts` (no imports) with tests: `npm test`.
  - The AI tab has a **Chat | Wiki** switch (`WikiBrowser.tsx`): browse/search/edit/move/delete. It is the one deliberate exception to "tools, not panels".
- Gmail drop-box: `scan_to_todos` / `scan` → todos (`DATA_DIR/todos.json`) **and** calendar events (tagged `extendedProperties.private.familyboardGmailId`), then `FamilyBoard/Processed` label. Optional `GMAIL_AUTO_SCAN_MINUTES`.
- Slack: same agent via Socket Mode (`src/lib/slack.ts`, `slack-bot.ts`), started from `src/instrumentation.ts`. Answers DMs and channel @mentions (thread replies); open to the whole workspace. Setup + manifest: `docs/SLACK_SETUP.md`.
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
