import { google } from "googleapis";
import { getOAuth2WithRefresh } from "./google";
import { gridsToAttachment, MAX_SHEETS, type ChatAttachment } from "./tabular";

export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  const fromUrl = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1];
  return /^[a-zA-Z0-9_-]{30,}$/.test(s) ? s : null;
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function explain(e: unknown): Error {
  const err = e as { code?: number | string; message?: string; response?: { status?: number } };
  const status = Number(err.response?.status ?? err.code);
  const message = err.message ?? String(e);
  if (/insufficient.*scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    return new Error(
      "Google Sheets access hasn't been granted yet: Disconnect Google on the board and Link Google again.",
    );
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return new Error("Enable the Google Sheets API in the Google Cloud project, then try again.");
  }
  if (status === 403) {
    return new Error("The linked Google account can't open that sheet. Share it with that account (view access is enough).");
  }
  if (status === 404) return new Error("That spreadsheet doesn't exist or the link is wrong.");
  return new Error(`Google Sheets: ${message}`);
}

export async function readGoogleSheet(
  redirectUri: string,
  input: { sheet: string; tab?: string },
): Promise<ChatAttachment & { title: string; url: string; tabs: string[] }> {
  const spreadsheetId = parseSpreadsheetId(input.sheet);
  if (!spreadsheetId) throw new Error("That doesn't look like a Google Sheets link or id.");
  const auth = await getOAuth2WithRefresh(redirectUri);
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties(title,hidden)",
    });
    const title = meta.data.properties?.title ?? "Spreadsheet";
    const tabs = (meta.data.sheets ?? [])
      .filter((s) => !s.properties?.hidden)
      .map((s) => s.properties?.title ?? "")
      .filter(Boolean);
    const wanted = input.tab?.trim()
      ? tabs.filter((t) => t.toLowerCase() === input.tab!.trim().toLowerCase())
      : tabs.slice(0, MAX_SHEETS);
    if (!wanted.length) {
      throw new Error(`No tab named “${input.tab}”. Tabs: ${tabs.join(", ")}`);
    }
    const values = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: wanted.map(quoteSheet),
      valueRenderOption: "FORMATTED_VALUE",
    });
    const grids = (values.data.valueRanges ?? []).map((r, i) => ({
      name: wanted[i],
      rows: (r.values ?? []).map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c)))),
    }));
    return {
      ...gridsToAttachment(title, grids),
      title,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      tabs,
    };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("No tab named")) throw e;
    throw explain(e);
  }
}
