import { isStravaConfigured } from "./strava";
import {
  ensureWikiSkillIfMissing,
  isWikilmGithubConfigured,
  listWikiPages,
  STRAVA_TRAINING_SKILL_PATH,
} from "./wikilm-github";

/** Canonical body for skills/strava-training.md (also mirrored in docs/wiki-skills/). */
export const STRAVA_TRAINING_SKILL_MARKDOWN = `---
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

Data comes from FamilyBoard's local cache (\`strava_training_summary\`), not Strava's official MCP. First sync pulls ~30 days; later syncs only new activities.

## Steps

1. Confirm who is asking (Strava actor). If tools return \`authorizeUrl\`, share it and stop — do not invent activities.
2. Call \`strava_training_summary\` (always syncs first). Optionally \`strava_athlete\` for name/city context.
   - Pass \`chartPeriod: "week"\` (default) or \`chartPeriod: "month"\` when they ask for a monthly / month-over-month chart.
3. Read \`summary.windowDays\`, \`activityCount\`, \`totals\`, \`byWeek\` (Monday-start weeks), \`byMonth\` (calendar months), \`bySport\`, and \`recent\`.
4. Convert units before speaking: distance m→km \`/1000\` or mi \`/1609.34\`; elevation m or ft (\`×3.281\`); run pace from \`average_speed_mps\` as min/km or min/mi — never show raw m/s to runners. Skip pace for non-distance sports (yoga, weight training, etc.).
5. Build a short recap (coach lens from [srothgan/strava-claude-skill](https://github.com/srothgan/strava-claude-skill)):
   - Window + activity count
   - Totals (distance, moving time, elevation; \`suffer_score\` = Relative Effort / load proxy when present)
   - Week-over-week from \`byWeek\` (or month-over-month from \`byMonth\` when chartPeriod=month): volume **and** load — flag spikes, empty periods, or load rising faster than time (intensity creep)
   - Sport mix from \`bySport\` (prose only — no separate sport-mix chart)
   - One highlight from \`recent\` if useful
6. Charts are attached automatically from the tool (AI tab + Slack). Prefer interpreting those; do not invent chart JSON.
   - **One chart:** **stacked moving time by sport (bars) + Relative Effort (line)** — weekly by default, monthly when requested. Time, not distance, so HIIT/strength show up. Cache is ~30 days, so monthly views may only show 1–2 months.
   - **Fallback** (no HR/\`suffer_score\`): stacked time by sport only.
7. Give 1–3 practical next steps (volume, easy days, consistency). If HR/\`suffer_score\` is missing on many activities, say load/form is incomplete.
8. Do **not** invent CTL/ATL/TSB ("Fitness/Fatigue/Form") or Premium-only analytics. A true PMC needs ~42 days of reliable daily load ([HenrikBrehm/triathlon-coach-skill](https://github.com/HenrikBrehm/triathlon-coach-skill)); with a 30-day cache, speak in week-over-week Relative Effort and volume only.
9. Do not claim medical diagnosis or guaranteed race times.

## Notes

- Coaching interpretation: [srothgan/strava-claude-skill](https://github.com/srothgan/strava-claude-skill) (\`training-interpretation.md\` — Relative Effort, 80/20, ~10% week progression).
- Form / PMC reference (when we someday have longer history + deterministic load): [HenrikBrehm/triathlon-coach-skill](https://github.com/HenrikBrehm/triathlon-coach-skill).
- Cache file: \`DATA_DIR/strava-activity-cache.json\`. Unlinking Strava clears that person's cache.
- Prefer this wiki page when present; the board also injects a built-in copy of this skill when Strava is configured.
- The board seeds this file automatically when Strava + wiki are configured (or via **Add skill to wiki** in AI Tools). Do not hand-copy unless you are editing offline.
`;

let seedInFlight: Promise<{ status: "created" | "exists" | "skipped"; path: string }> | null =
  null;
/** After a successful ensure, skip repeat GitHub writes until the process restarts. */
let seedCompleted: "created" | "exists" | null = null;

/**
 * When Strava + wiki are both configured, create skills/strava-training.md once if missing.
 * Never overwrites an existing page (family edits win).
 */
export async function ensureStravaTrainingWikiSkill(): Promise<{
  status: "created" | "exists" | "skipped";
  path: string;
}> {
  if (!isStravaConfigured() || !isWikilmGithubConfigured()) {
    return { status: "skipped", path: STRAVA_TRAINING_SKILL_PATH };
  }
  if (seedCompleted) {
    return { status: seedCompleted, path: STRAVA_TRAINING_SKILL_PATH };
  }
  if (!seedInFlight) {
    seedInFlight = ensureWikiSkillIfMissing({
      path: STRAVA_TRAINING_SKILL_PATH,
      content: STRAVA_TRAINING_SKILL_MARKDOWN,
      commitMessage: "skill: add strava-training (board seed)",
    })
      .then((result) => {
        seedCompleted = result.status;
        return { status: result.status, path: STRAVA_TRAINING_SKILL_PATH };
      })
      .finally(() => {
        seedInFlight = null;
      });
  }
  return seedInFlight;
}

/** True when the wiki already has skills/strava-training.md (best-effort; used by status UI). */
export async function stravaTrainingSkillPresentInWiki(): Promise<boolean> {
  if (!isWikilmGithubConfigured()) return false;
  try {
    const pages = await listWikiPages();
    return pages.some((p) => p.path === STRAVA_TRAINING_SKILL_PATH);
  } catch {
    return false;
  }
}
