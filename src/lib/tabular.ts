// Pure helpers for turning spreadsheets into text the model can read (no imports; unit-tested).

export type ChatAttachment = {
  name: string;
  kind: "sheet" | "text";
  /** Short human description, e.g. "2 sheets, 41 rows". */
  summary: string;
  text: string;
  truncated?: boolean;
};

export const MAX_ATTACHMENT_CHARS = 60_000;
export const MAX_SHEETS = 10;

export type SheetGrid = { name: string; rows: string[][] };

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV with trailing empty cells and empty rows dropped. */
export function rowsToCsv(rows: readonly (readonly string[])[]): { csv: string; rowCount: number } {
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.map((c) => (c ?? "").replace(/\r\n?/g, "\n").trim());
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.length) continue;
    lines.push(cells.map(csvCell).join(","));
  }
  return { csv: lines.join("\n"), rowCount: lines.length };
}

/** Cut at a line boundary and say how much was left out. */
export function truncateLines(text: string, max = MAX_ATTACHMENT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const kept = cut.slice(0, Math.max(cut.lastIndexOf("\n"), 0));
  const dropped = text.slice(kept.length).split("\n").filter(Boolean).length;
  return { text: `${kept}\n…(truncated: ${dropped} more line(s) not shown)`, truncated: true };
}

export function gridsToAttachment(name: string, grids: readonly SheetGrid[]): ChatAttachment {
  const sheets = grids.slice(0, MAX_SHEETS).map((g) => ({ name: g.name, ...rowsToCsv(g.rows) }));
  const nonEmpty = sheets.filter((s) => s.rowCount > 0);
  const rows = nonEmpty.reduce((n, s) => n + s.rowCount, 0);
  const body =
    nonEmpty.length === 1 && grids.length === 1
      ? nonEmpty[0].csv
      : nonEmpty.map((s) => `## Sheet: ${s.name} (${s.rowCount} rows)\n${s.csv}`).join("\n\n");
  const { text, truncated } = truncateLines(body || "(empty spreadsheet)");
  const sheetPart = grids.length > 1 ? `${nonEmpty.length} sheets, ` : "";
  return {
    name,
    kind: "sheet",
    summary: `${sheetPart}${rows} row${rows === 1 ? "" : "s"}${truncated ? ", truncated" : ""}`,
    text,
    ...(truncated ? { truncated } : {}),
  };
}

/** Parse delimited text (CSV/TSV) so it can be normalized like a workbook. */
export function parseDelimited(text: string, delimiter: "," | "\t" = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && !cell) {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Spreadsheet dates carry wall-clock time with no zone; libraries hand them back
 * as UTC Dates, so read the UTC fields to recover what the sheet shows.
 */
export function formatSheetDate(d: Date): string {
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (d.getUTCFullYear() === 1899 && d.getUTCMonth() === 11 && d.getUTCDate() === 30) {
    return `${pad(h)}:${pad(m)}`;
  }
  return h || m ? `${date} ${pad(h)}:${pad(m)}` : date;
}

/** Block appended to a user message so the model sees the file's contents. */
export function attachmentsToPrompt(attachments: readonly ChatAttachment[]): string {
  return attachments
    .map((a) => {
      const label = a.kind === "sheet" ? "spreadsheet" : "file";
      const fence = a.text.includes("```") ? "~~~~" : "```";
      return `[Attached ${label} "${a.name}" (${a.summary})]\n${fence}${a.kind === "sheet" ? "csv" : ""}\n${a.text}\n${fence}`;
    })
    .join("\n\n");
}
