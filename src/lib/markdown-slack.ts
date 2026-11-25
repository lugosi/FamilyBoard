/**
 * Slack mrkdwn does not render GFM pipe tables. Convert them to a readable
 * monospace block (or compact bullets for small tables) before posting.
 *
 * Models often emit near-tables (no separator row, mismatched sep cols, or
 * missing outer pipes). Detect those too — strict GFM-only missed most replies.
 */

const SEP_CELL_RE = /^:?-{1,}:?$/;

/** Strip common markdown emphasis so Slack mrkdwn / monospace stay clean. */
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
  // A lone prose pipe ("yes | no thanks") is usually long; table cells stay short-ish.
  if (!trimmed.startsWith("|") && cells.some((c) => c.length > 48)) return null;
  return cells;
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEP_CELL_RE.test(c));
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : `${s}${" ".repeat(width - s.length)}`;
}

function normalizeRows(rows: string[][]): string[][] {
  const cols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const next = r.slice(0, cols).map(cleanSlackTableCell);
    while (next.length < cols) next.push("");
    return next;
  });
}

/** Compact bullets — reliable on Slack mobile; no code-fence dependency. */
export function formatSlackTableBullets(rows: string[][]): string {
  const normalized = normalizeRows(rows);
  if (!normalized.length) return "";
  const [header, ...data] = normalized;
  if (!header) return "";
  const body = data.length ? data : [header.map(() => "")];
  if (header.length === 2 && data.length) {
    return body
      .map((r) => `• *${r[0] || "—"}*: ${r[1] || "—"}`)
      .join("\n");
  }
  return body
    .map((r) => {
      const parts = header.map((h, i) => `*${h || `Col ${i + 1}`}*: ${r[i] || "—"}`);
      return `• ${parts.join(" · ")}`;
    })
    .join("\n");
}

/** Format a parsed table as a fenced code block Slack will show monospace. */
export function formatSlackTableCode(rows: string[][]): string {
  if (!rows.length) return "";
  const normalized = normalizeRows(rows);
  const cols = normalized[0]?.length ?? 0;
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.min(40, Math.max(1, ...normalized.map((r) => (r[i] ?? "").length))),
  );
  const lines = normalized.map((r) =>
    r.map((cell, i) => pad(cell.slice(0, widths[i]!), widths[i]!)).join("  "),
  );
  if (lines.length >= 2) {
    const rule = widths.map((w) => "-".repeat(w)).join("  ");
    lines.splice(1, 0, rule);
  }
  return ["```", ...lines, "```"].join("\n");
}

/**
 * Prefer bullets for phone-friendly small tables; code fence for wider grids.
 */
export function formatSlackTable(rows: string[][]): string {
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const dataRows = Math.max(0, rows.length - 1);
  if (cols <= 4 && dataRows <= 8) return formatSlackTableBullets(rows);
  return formatSlackTableCode(rows);
}

function looksLikeTableBlock(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const cols = rows[0]!.length;
  if (cols < 2) return false;
  // Require mostly consistent column counts (models sometimes drop a trailing cell).
  const consistent = rows.filter((r) => Math.abs(r.length - cols) <= 1).length;
  return consistent >= Math.ceil(rows.length * 0.75);
}

/**
 * Replace GFM / near-GFM pipe-table blocks with Slack-friendly text.
 * Leaves non-table content unchanged. Rewrites pipe tables inside fences too
 * (those still show raw `|` in monospace otherwise).
 */
export function markdownTablesForSlack(text: string): string {
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
        const rewritten = rewritePipeTables(inner);
        if (rewritten !== inner && !rewritten.includes("|")) {
          // Fully converted — drop the outer fence (bullets/code already formatted).
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
      out.push(formatSlackTable(consumed.rows));
      i = consumed.next;
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n");
}

function rewritePipeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const consumed = tryConsumeTable(lines, i);
    if (consumed) {
      out.push(formatSlackTable(consumed.rows));
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
    // Classic GFM (tolerate mismatched sep column count).
    i = start + 2;
  } else if (
    second.length >= 2 &&
    Math.abs(second.length - header.length) <= 1 &&
    // Separator-less tables are common from LLMs; require leading `|` so
    // prose like "Mon | Tue" is not treated as a grid.
    lines[start]!.trim().startsWith("|") &&
    lines[start + 1]!.trim().startsWith("|")
  ) {
    rows.push(second);
    i = start + 2;
  } else {
    return null;
  }

  while (i < lines.length) {
    const blank = lines[i]!.trim() === "";
    if (blank) break;
    const row = splitTableRow(lines[i]!);
    if (!row || isSeparatorRow(row)) break;
    if (Math.abs(row.length - header.length) > 1 && row.length < 2) break;
    rows.push(row);
    i += 1;
  }

  if (!looksLikeTableBlock(rows)) return null;
  // Need a header + at least one data row (sep-only GFM still needs data, or
  // header+sep with no data is useless — require ≥2 content rows after dropping sep).
  if (rows.length < 2) return null;
  return { rows, next: i };
}
