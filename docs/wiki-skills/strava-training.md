---
title: Strava training
summary: Analyze the linked person's last 30 days of Strava from the board cache (bootstrap then diff); week-over-week volume and practical next steps
tags: [skill, strava, training]
---

# Strava training

## When to use

Someone asks how training is going, for mileage/load, a weekly or monthly Strava recap, race readiness, or coaching-style analysis of their workouts. Also when they say "analyze my Strava" or "how were my last few weeks."

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
5. Build a short recap:
   - Window + activity count
   - Totals (distance, moving time, elevation; `suffer_score` only if present — treat as Relative Effort proxy)
   - Week-over-week from `byWeek` (up/down vs prior week; flag big spikes or empty weeks)
   - Sport mix from `bySport`
   - One highlight from `recent` if useful
6. Give 1–3 practical next steps (volume, easy days, consistency). If HR/`suffer_score` is missing on many activities, say load is incomplete.
7. Do not claim medical diagnosis, guaranteed race times, or Strava Premium analytics the cache does not have.

## Notes

- Inspiration for the coaching lens: public Strava coach skills (e.g. [srothgan/strava-claude-skill](https://github.com/srothgan/strava-claude-skill)) — adapted here for FamilyBoard REST tools and the 30-day cache.
- Cache file: `DATA_DIR/strava-activity-cache.json`. Unlinking Strava clears that person's cache.
- Prefer this wiki page when present; the board also injects a built-in copy of this skill when Strava is configured.
