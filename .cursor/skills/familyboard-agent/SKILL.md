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

- Shell: `AppShell` tabs **Board** | **AI** (`?tab=ai`). Do not fold AI UI into `Board.tsx`.
- Knowledge base: **private GitHub markdown only** (`WIKILM_GITHUB_*`) via `src/lib/wikilm-github.ts`. Never store wiki pages in `DATA_DIR`.
- Chat: `POST /api/wiki/chat` grounds Gemini on wiki context. Save: `POST /api/wiki/control` `save_page`.
- Gmail drop-box: read + `FamilyBoard/Processed` label; `scan_to_todos` → `DATA_DIR/todos.json` (not GitHub).
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
