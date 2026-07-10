---
name: familyboard-qa
description: >-
  Run FamilyBoard QA: API smoke plus Gherkin board scenarios. Use when the user
  asks to QA, smoke-test, verify the board, or do a pre-merge check.
---

# FamilyBoard QA

Follow this skill when the user asks to QA / smoke-test / verify the board / pre-merge check.

Do **not** mutate devices in default QA (no CatLink Clean, Hue toggles, Spotify play/pause) unless the user explicitly asks.

## Fixed order

1. **Server up** — Confirm something answers at `BASE_URL` (default `http://127.0.0.1:3000`). If not, start `npm run dev` or a production-like server:
   - Prefer `DATA_DIR` pointing at a writable folder (e.g. `./data`). Do not use `DATA_DIR=/data` unless that path exists.
   - After `npm run build` with `output: "standalone"`: copy `public` + `.next/static` into `.next/standalone` (same as CI), then `node .next/standalone/server.js`.
   - Leave `BOARD_ACCESS_*` unset unless the user intends to test the gate (then unlock first via `POST /api/unlock`).
2. **API smoke** — Run `npm run qa:smoke` (optional `BASE_URL=...`). Record the pass/fail table. Fix or report any `FAIL` before claiming green.
3. **Gherkin scenarios** — Walk every scenario under [`qa/features/`](../../../qa/features/) against the live board (fetch HTML and/or browser tools). Cross-check `Given` flags with `GET /api/auth/status`. Skip scenarios whose preconditions are false; mark them **skipped**, not failed.
4. **Report** — Structured summary only:

```text
## QA summary
- Smoke: N/N passed (or list failures)
- Features: pass / fail / skipped per Scenario
- Blockers: …
```

## Feature files (source of truth)

| File | Covers |
|------|--------|
| [`qa/features/board_shell.feature`](../../../qa/features/board_shell.feature) | Gate off/on, unlock |
| [`qa/features/calendar.feature`](../../../qa/features/calendar.feature) | Calendar column vs Google link |
| [`qa/features/widgets.feature`](../../../qa/features/widgets.feature) | Clock + Weather/Catlink/Spotify/Hue/Indoor |

These `.feature` files are **agent specs**, not an executable Cucumber suite. Interpret steps literally against the running app.

## Smoke expectations (quick)

| Route | Accept |
|-------|--------|
| `/api/auth/status` | 200 |
| `/api/weather` | 200 if weather configured, else 501 |
| Calendar / CatLink / Nest / Hue / Spotify | Status-aware per `auth/status` flags (see smoke script) |

Unexpected **5xx**, **401 Locked** (gate on without cookie), or connection errors = fail.

## After code changes

For non-trivial board/API edits, also run `npm run build` (see `AGENTS.md`).
