<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FamilyBoard agent

For dashboard, widget, and integration work, follow the project skill:

- [`.cursor/skills/familyboard-agent/SKILL.md`](.cursor/skills/familyboard-agent/SKILL.md) — architecture, Board patterns, calendar/weather rules
- [`.cursor/skills/familyboard-agent/integrations.md`](.cursor/skills/familyboard-agent/integrations.md) — CatLink / Spotify / Hue / Nest / Google gotchas

For QA / smoke / pre-merge verification:

- [`.cursor/skills/familyboard-qa/SKILL.md`](.cursor/skills/familyboard-qa/SKILL.md) — API smoke + Gherkin board scenarios
- [`qa/features/`](qa/features/) — agent checklist as `.feature` files (not executable Cucumber)
- `npm run qa:smoke` — deterministic snapshot API checks (server must be running)

Verify non-trivial changes with `npm run build`.

## Cursor Cloud specific instructions

- Node 22 and npm are on the default image. Install with `npm ci`. Start the app with `npm run dev` (port 3000). Open the board at `http://localhost:3000`. Next.js 16 blocks dev assets (and hydration) when the page is opened as `127.0.0.1`, so the board stays on its server-rendered placeholders and tabs do not switch.
- Do not copy `DATA_DIR=/data` from `.env.example` onto this VM. That path is for the Docker image. Use `DATA_DIR=$PWD/data` (the app creates the directory). Leave `BOARD_ACCESS_CODE` and `BOARD_ACCESS_SECRET` unset, or every page redirects to `/unlock` and APIs return 401.
- Weather needs no API key. Set `WEATHER_LAT` and `WEATHER_LON` (`.env.example` uses 37.77 and -122.42) so `GET /api/weather` returns 200. Open-Meteo must be reachable.
- Google, Spotify, Hue, CatLink, Nest, Gemini, and the wiki are optional. Without those secrets the board still loads and those widgets stay unconfigured. `npm run qa:smoke` expects a server at `http://127.0.0.1:3000` and passes in that state.
- `npm run lint` and `npm run build` are the lint and typecheck gates. There is no separate unit-test script.
