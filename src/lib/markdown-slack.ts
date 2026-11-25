/**
 * Slack mrkdwn / Block Kit cannot render GFM tables. Convert pipe tables to
 * mobile-friendly bullets before posting. Never use padded monospace code-fence
 * grids (they wrap unreadably on phone).
 *
 * When a row has a known calendar day, append a Google Calendar day-view link
 * (`/calendar/r/day/Y/M/D`) — opens the Calendar app/web. No invented dates.
 */

const SEP_CELL_RE = /^:?-{1,}:?$/;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export type SlackTableFormatOpts = {
  /** Reference instant for Today/Tomorrow (defaults to now). */
  now?: Date;
  /** IANA zone for Today/Tomorrow (defaults to America/Los_Angeles). */
  timeZone?: string;
};

/** Strip common markdown emphasis so Slack mrkdwn stays clean. */
export function cleanSlackTableCell(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`+/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a pipe-row into cells. Accepts optional leading/trailing `|`.
 * Returns null when the line is not table-like (≥2 cells).
 */
export function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  const cells = body.split("|").map((c) => c.trim());
  if (cells.length < 2) return null;
  if (!trimmed.startsWith("|") && cells.some((c) => c.length > 48)) return null;
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEP_CELL_RE.test(c));
}

function normalizeRows(rows: string[][]): string[][] {
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const next = r.slice(0, cols).map(cleanSlackTableCell);
    while (next.length < cols) next.push("");
    return next;
  });
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKeyPartsInZone(now: Date, timeZone: string): { y: number; m: number; d: number; key: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, d, key: `${y}-${pad2(m)}-${pad2(d)}` };
}

/** Civil-date arithmetic on YYYY-MM-DD (no TZ shift). */
function addDaysToDateKey(dateKey: string, days: number): string {
  const [ys, ms, ds] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(ys!, ms! - 1, ds! + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function validDateKey(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1970 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Google Calendar day view. Unpadded M/D; opens web or mobile Calendar app.
 * No FamilyBoard-specific deep link existed in-repo — this is the standard URL.
 */
export function googleCalendarDayUrl(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim());
  if (!m) return "https://calendar.google.com/calendar/r/day";
  return `https://calendar.google.com/calendar/r/day/${m[1]}/${Number(m[2])}/${Number(m[3])}`;
}

/**
 * Extract a concrete YYYY-MM-DD from cell text when unambiguous.
 * Accepts ISO dates, Month D, YYYY, M/D/YYYY; optionally Today/Tomorrow.
 * Does **not** invent a year for "Nov 25" or resolve bare weekdays / "Sat 10am".
 */
export function parseDateKeyFromCell(
  raw: string,
  opts: SlackTableFormatOpts & { allowRelative?: boolean } = {},
): string | null {
  const text = cleanSlackTableCell(raw);
  if (!text) return null;
  const timeZone = opts.timeZone || "America/Los_Angeles";
  const now = opts.now ?? new Date();

  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return validDateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|\d{2})\b/);
  if (slash) {
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    return validDateKey(y, Number(slash[1]), Number(slash[2]));
  }

  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))\b/i,
  );
  if (named) {
    const month = MONTHS[named[1]!.toLowerCase()];
    if (month) return validDateKey(Number(named[3]), month, Number(named[2]));
  }

  if (opts.allowRelative !== false) {
    // Whole-cell (or leading) only — avoid "Today's lunch" in an Item column.
    if (/^today\b/i.test(text)) return dateKeyPartsInZone(now, timeZone).key;
    if (/^tomorrow\b/i.test(text)) {
      const today = dateKeyPartsInZone(now, timeZone).key;
      return addDaysToDateKey(today, 1);
    }
  }

  return null;
}

function isDateishHeader(h: string): boolean {
  return /^(when|date|day|start|starts|on)$/i.test(h.trim());
}

/** Pick a known date from the row; prefer When/Date/Day columns. */
export function dateKeyFromTableRow(
  header: string[],
  row: string[],
  opts: SlackTableFormatOpts = {},
): string | null {
  const prefer: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < header.length; i += 1) {
    if (isDateishHeader(header[i] || "")) prefer.push(i);
    else rest.push(i);
  }
  for (const i of prefer) {
    const key = parseDateKeyFromCell(row[i] || "", { ...opts, allowRelative: true });
    if (key) return key;
  }
  for (const i of rest) {
    // Non-date columns: only absolute dates (no Today/Tomorrow false positives).
    const key = parseDateKeyFromCell(row[i] || "", { ...opts, allowRelative: false });
    if (key) return key;
  }
  return null;
}

function slackCalLink(dateKey: string): string {
  return `<${googleCalendarDayUrl(dateKey)}|Cal>`;
}

/**
 * One bullet per data row — wraps cleanly on Slack mobile.
 * 2-col: `• *Key*: Value`
 * 3-col: `• *Area* · When — Item` (+ Cal link when date known)
 * 4+: labeled fields on one line with · separators
 */
export function formatSlackTableBullets(
  rows: string[][],
  opts: SlackTableFormatOpts = {},
): string {
  const normalized = normalizeRows(rows);
  if (!normalized.length) return "";
  const [header, ...data] = normalized;
  if (!header) return "";
  const body = data.length ? data : [];
  if (!body.length) return "";

  return body
    .map((r) => {
      const dateKey = dateKeyFromTableRow(header, r, opts);
      const cal = dateKey ? ` ${slackCalLink(dateKey)}` : "";

      if (header.length === 2) {
        return `• *${r[0] || "—"}*: ${r[1] || "—"}${cal}`;
      }
      if (header.length === 3) {
        return `• *${r[0] || "—"}* · ${r[1] || "—"} — ${r[2] || "—"}${cal}`;
      }
      const parts = header.map((h, i) => `*${h || `Col ${i + 1}`}*: ${r[i] || "—"}`);
      return `• ${parts.join(" · ")}${cal}`;
    })
    .join("\n");
}

/** @deprecated Always bullets — alias kept for older imports/tests. */
export function formatSlackTableCode(
  rows: string[][],
  opts: SlackTableFormatOpts = {},
): string {
  return formatSlackTableBullets(rows, opts);
}

/** Always bullets — never column-aligned monospace. */
export function formatSlackTable(
  rows: string[][],
  opts: SlackTableFormatOpts = {},
): string {
  return formatSlackTableBullets(rows, opts);
}

function looksLikeTableBlock(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const cols = rows[0]!.length;
  if (cols < 2) return false;
  const consistent = rows.filter((r) => Math.abs(r.length - cols) <= 1).length;
  return consistent >= Math.ceil(rows.length * 0.75);
}

/**
 * Replace GFM / near-GFM pipe-table blocks with Slack-friendly bullets.
 * Rewrites pipe tables inside fences too.
 */
export function markdownTablesForSlack(
  text: string,
  opts: SlackTableFormatOpts = {},
): string {
  const raw = text.replace(/\r\n?/g, "\n");
  if (!raw.includes("|")) return raw;

  const out: string[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const fenceOpen = line.match(/^\s*(```|~~~)/);

    if (fenceOpen) {
      const mark = fenceOpen[1]!;
      const fenceBody: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(mark)) {
        fenceBody.push(lines[i]!);
        i += 1;
      }
      const close = i < lines.length ? lines[i]! : "";
      if (i < lines.length) i += 1;

      const inner = fenceBody.join("\n");
      if (inner.includes("|")) {
        const rewritten = rewritePipeTables(inner, opts);
        if (rewritten !== inner && !rewritten.includes("|")) {
          out.push(rewritten);
          continue;
        }
        if (rewritten !== inner) {
          out.push(line, rewritten, close);
          continue;
        }
      }
      out.push(line, ...fenceBody);
      if (close) out.push(close);
      continue;
    }

    const consumed = tryConsumeTable(lines, i);
    if (consumed) {
      out.push(formatSlackTable(consumed.rows, opts));
      i = consumed.next;
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n");
}

function rewritePipeTables(text: string, opts: SlackTableFormatOpts): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const consumed = tryConsumeTable(lines, i);
    if (consumed) {
      out.push(formatSlackTable(consumed.rows, opts));
      i = consumed.next;
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}

function tryConsumeTable(
  lines: string[],
  start: number,
): { rows: string[][]; next: number } | null {
  const header = splitTableRow(lines[start] ?? "");
  if (!header) return null;

  const second = start + 1 < lines.length ? splitTableRow(lines[start + 1]!) : null;
  if (!second) return null;

  const rows: string[][] = [header];
  let i = start + 1;

  if (isSeparatorRow(second)) {
    i = start + 2;
  } else if (
    second.length >= 2 &&
    Math.abs(second.length - header.length) <= 1 &&
    lines[start]!.trim().startsWith("|") &&
    lines[start + 1]!.trim().startsWith("|")
  ) {
    rows.push(second);
    i = start + 2;
  } else {
    return null;
  }

  while (i < lines.length) {
    if (lines[i]!.trim() === "") break;
    const row = splitTableRow(lines[i]!);
    if (!row || isSeparatorRow(row)) break;
    if (Math.abs(row.length - header.length) > 1 && row.length < 2) break;
    rows.push(row);
    i += 1;
  }

  if (!looksLikeTableBlock(rows)) return null;
  if (rows.length < 2) return null;
  return { rows, next: i };
}
