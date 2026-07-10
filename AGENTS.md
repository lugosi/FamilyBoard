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
