import { getBackgroundGoogleRedirectUri } from "./app-url";
import { syncCatDietHistory } from "./cat-diet-history";
import { tickDailyBrief } from "./daily-brief";
import { readDailyBriefStore } from "./daily-brief-store";
import { isGeminiConfigured } from "./gemini";
import { scanInboxToTodos } from "./gmail";
import { readGoogleTokens } from "./google";
import { getCatlinkConfig } from "./catlink";
import { getPetlibroConfig } from "./petlibro";
import { startSlackBot } from "./slack-bot";

const g = globalThis as typeof globalThis & { __familyboardBackground?: boolean };

/** 0 disables. */
export function getInboxAutoScanMinutes(): number {
  const min = Number(process.env.GMAIL_AUTO_SCAN_MINUTES);
  return Number.isFinite(min) && min >= 1 ? Math.floor(min) : 0;
}

function startInboxAutoScan(): void {
  const minutes = getInboxAutoScanMinutes();
  if (!minutes) return;
  const run = async () => {
    try {
      if (!isGeminiConfigured() || !(await readGoogleTokens())?.refresh_token) return;
      const result = await scanInboxToTodos(getBackgroundGoogleRedirectUri());
      if (result.scanned > 0) {
        const events = result.events.filter((e) => e.ok).length;
        console.log(
          `[inbox] auto-scan: ${result.scanned} email(s), ${result.added.length} todo(s), ${events} event(s)`,
        );
      }
    } catch (e) {
      console.warn("[inbox] auto-scan failed:", e instanceof Error ? e.message : e);
    }
  };
  setInterval(() => void run(), minutes * 60_000);
  console.log(`[inbox] auto-scan every ${minutes} min`);
}

function startDailyBriefTicker(): void {
  const tickMs = 60_000;
  const run = () => void tickDailyBrief();
  setInterval(run, tickMs);
  // Catch up shortly after boot if we're already past 7am local.
  setTimeout(run, 8_000);
  void readDailyBriefStore().then((s) => {
    if (!s.enabled) {
      console.log("[daily-brief] disabled");
      return;
    }
    console.log(
      `[daily-brief] scheduled ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} ${s.timeZone} → Slack (${s.slackUserIds.length}) + web=${s.webAgent ? "on" : "off"}`,
    );
  });
}

function startCatDietHistoryTicker(): void {
  const tickMs = 60 * 60 * 1000;
  const run = async () => {
    try {
      if (!(await getPetlibroConfig()) && !(await getCatlinkConfig())) return;
      const row = await syncCatDietHistory();
      if (row) {
        console.log(`[cat-diet] synced ${row.dateKey}`);
      }
    } catch (e) {
      console.warn("[cat-diet] sync failed:", e instanceof Error ? e.message : e);
    }
  };
  setInterval(() => void run(), tickMs);
  setTimeout(() => void run(), 20_000);
  console.log("[cat-diet] history sync hourly when Petlibro/CatLink linked");
}

export function startBackgroundJobs(): void {
  if (g.__familyboardBackground) return;
  g.__familyboardBackground = true;
  startSlackBot();
  startInboxAutoScan();
  startDailyBriefTicker();
  startCatDietHistoryTicker();
}
