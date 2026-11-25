/**
 * Slack mrkdwn does not render GFM pipe tables. Convert them to a readable
 * monospace block (or compact bullets for tiny tables) before posting.
 */

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const SEP_CELL_RE = /^\s*:?-{3,}:?\s*$/;

function splitRow(line: string): string[] | null {
  const m = line.match(TABLE_ROW_RE);
  if (!m) return null;
  return m[1].split("|").map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => SEP_CELL_RE.test(c));
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : `${s}${" ".repeat(width - s.length)}`;
}

/** Format a parsed table as a fenced code block Slack will show monospace. */
export function formatSlackTable(rows: string[][]): string {
  if (!rows.length) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => {
    const next = r.slice(0, cols);
    while (next.length < cols) next.push("");
    return next;
  });
  const widths = Array.from({ length: cols }, (_, i) =>
    Math.min(40, Math.max(1, ...normalized.map((r) => (r[i] ?? "").length))),
  );
  const lines = normalized.map((r) =>
    r.map((cell, i) => pad(cell.slice(0, widths[i]!), widths[i]!)).join("  "),
  );
  // Insert a dashed rule under the header when we have ≥2 rows.
  if (lines.length >= 2) {
    const rule = widths.map((w) => "-".repeat(w)).join("  ");
    lines.splice(1, 0, rule);
  }
  return ["```", ...lines, "```"].join("\n");
}

/**
 * Replace GFM pipe-table blocks in markdown with Slack-friendly text.
 * Leaves non-table content unchanged (including fenced code).
 */
export function markdownTablesForSlack(text: string): string {
  const raw = text.replace(/\r\n?/g, "\n");
  if (!raw.includes("|")) return raw;

  const out: string[] = [];
  const lines = raw.split("\n");
  let i = 0;
  let inFence = false;

  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      i += 1;
      continue;
    }
    if (inFence) {
      out.push(line);
      i += 1;
      continue;
    }

    const header = splitRow(line);
    const next = i + 1 < lines.length ? splitRow(lines[i + 1]!) : null;
    if (header && next && isSeparatorRow(next) && header.length === next.length) {
      const rows: string[][] = [header];
      i += 2;
      while (i < lines.length) {
        const row = splitRow(lines[i]!);
        if (!row || isSeparatorRow(row)) break;
        rows.push(row);
        i += 1;
      }
      out.push(formatSlackTable(rows));
      continue;
    }

    out.push(line);
    i += 1;
  }

  return out.join("\n");
}
