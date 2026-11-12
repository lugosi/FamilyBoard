---
title: Strava training
summary: Analyze the linked person's last 30 days of Strava from the board cache; volume vs Relative Effort charts and practical next steps
tags: [skill, strava, training]
---

# Strava training

## When to use

Someone asks how training is going, for mileage/load, form/freshness, a weekly or monthly Strava recap, race readiness, a chart, or coaching-style analysis of their workouts. Also when they say "analyze my Strava" or "how were my last few weeks."

## Inputs

- Linked Strava for the current speaker (Board: pick member in AI → Tools; Slack: that Slack user).
- Optional: preferred units (km vs miles). Default **km** unless they ask for miles.
- Optional: goal (race date/distance, "base building", "recovery week") — ask once if missing and it matters.

Data comes from FamilyBoard's local cache (`strava_training_summary`), not Strava's official MCP. First sync pulls ~30 days; later syncs only new activities.

## Steps

1. Confirm who is asking (Strava actor). If tools return `authorizeUrl`, share it and stop — do not invent activities.
2. Call `strava_training_summary` (always syncs first). Optionally `strava_athlete` for name/city context.
3. Read `summary.windowDays`, `activityCount`, `totals`, `byWeek` (Monday-start weeks, newest first), `bySport`, and `recent`.
4. Convert units before speaking: distance m→km `/1000` or mi `/1609.34`; elevation m or ft (`×3.281`); run pace from `average_speed_mps` as min/km or min/mi — never show raw m/s to runners. Skip pace for non-distance sports (yoga, weight training, etc.).
5. Build a short recap (coach lens from [srothgan/strava-claude-skill](https://github.com/srothgan/strava-claude-skill)):
   - Window + activity count
   - Totals (distance, moving time, elevation; `suffer_score` = Relative Effort / load proxy when present)
   - Week-over-week from `byWeek`: volume **and** load — flag spikes, empty weeks, or load rising faster than distance (intensity creep)
   - Sport mix from `bySport`
   - One highlight from `recent` if useful
6. Charts are attached automatically from the tool (AI tab + Slack). Prefer interpreting those; do not invent chart JSON.
   - **Primary:** weekly **distance (bars) + Relative Effort (line)** — best "current form / load" view with 30 days of list activities.
   - **Fallback** (no HR/`suffer_score`): distance + moving time.
   - **Sport mix:** distance + Relative Effort when present, else distance + sessions.
7. Give 1–3 practical next steps (volume, easy days, consistency). If HR/`suffer_score` is missing on many activities, say load/form is incomplete.
8. Do **not** invent CTL/ATL/TSB ("Fitness/Fatigue/Form") or Premium-only analytics. A true PMC needs ~42 days of reliable daily load ([HenrikBrehm/triathlon-coach-skill](https://github.com/HenrikBrehm/triathlon-coach-skill)); with a 30-day cache, speak in week-over-week Relative Effort and volume only.
9. Do not claim medical diagnosis or guaranteed race times.

## Notes

- Coaching interpretation: [srothgan/strava-claude-skill](https://github.com/srothgan/strava-claude-skill) (`training-interpretation.md` — Relative Effort, 80/20, ~10% week progression).
- Form / PMC reference (when we someday have longer history + deterministic load): [HenrikBrehm/triathlon-coach-skill](https://github.com/HenrikBrehm/triathlon-coach-skill).
- Cache file: `DATA_DIR/strava-activity-cache.json`. Unlinking Strava clears that person's cache.
- Prefer this wiki page when present; the board also injects a built-in copy of this skill when Strava is configured.
- The board seeds this file automatically when Strava + wiki are configured (or via **Add skill to wiki** in AI Tools). Do not hand-copy unless you are editing offline.
