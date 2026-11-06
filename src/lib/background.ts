import { getBackgroundGoogleRedirectUri } from "./app-url";
import { isGeminiConfigured } from "./gemini";
import { scanInboxToTodos } from "./gmail";
import { readGoogleTokens } from "./google";
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

export function startBackgroundJobs(): void {
  if (g.__familyboardBackground) return;
  g.__familyboardBackground = true;
  startSlackBot();
  startInboxAutoScan();
}
