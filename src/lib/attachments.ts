import type ExcelJS from "exceljs";
import {
  formatSheetDate,
  gridsToAttachment,
  MAX_SHEETS,
  parseDelimited,
  truncateLines,
  type ChatAttachment,
  type SheetGrid,
} from "./tabular";

export type { ChatAttachment } from "./tabular";
export { attachmentsToPrompt, imageAttachments, imagePromptNote } from "./tabular";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "json", "ics", "yaml", "yml", "xml", "html", "htm"]);

function extensionOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatSheetDate(value);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return result === undefined ? "" : cellText(result);
    }
    if ("hyperlink" in value) {
      const v = value as { text?: unknown; hyperlink: string };
      return typeof v.text === "string" ? v.text : v.hyperlink;
    }
    if ("error" in value) return String((value as { error: unknown }).error);
    return "";
  }
  return String(value);
}

async function workbookGrids(data: Buffer): Promise<SheetGrid[]> {
  // Loaded on demand so a broken optional dependency can't take down the Slack bot or other routes.
  const { default: Excel } = await import("exceljs");
  const wb = new Excel.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch {
    throw new AttachmentError("Couldn't read that workbook. Save it as .xlsx or CSV and try again.");
  }
  const grids: SheetGrid[] = [];
  wb.eachSheet((ws) => {
    if (grids.length >= MAX_SHEETS || ws.state === "hidden" || ws.state === "veryHidden") return;
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellText(cell.value);
      });
      rows.push(Array.from(cells, (c) => c ?? ""));
    });
    grids.push({ name: ws.name, rows });
  });
  return grids;
}

/** Convert an uploaded file into text the assistant can read. */
export async function fileToAttachment(
  name: string,
  mime: string,
  data: Buffer,
): Promise<ChatAttachment> {
  const safeName = name.replace(/[\r\n"]/g, " ").trim().slice(0, 120) || "file";
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(`${safeName} is larger than 5 MB.`);
  }
  const ext = extensionOf(safeName);
  const type = mime.toLowerCase();

  if (ext === "xlsx" || ext === "xlsm" || type.includes("spreadsheetml")) {
    return gridsToAttachment(safeName, await workbookGrids(data));
  }
  if (ext === "xls" || ext === "numbers" || ext === "ods") {
    throw new AttachmentError(`Save ${safeName} as .xlsx or CSV first (that format isn't supported).`);
  }
  if (ext === "csv" || ext === "tsv" || type === "text/csv" || type === "text/tab-separated-values") {
    const text = data.toString("utf8");
    const delimiter = ext === "tsv" || type.includes("tab-separated") ? "\t" : ",";
    return gridsToAttachment(safeName, [{ name: safeName, rows: parseDelimited(text, delimiter) }]);
  }
  if (type.startsWith("text/") || TEXT_EXTENSIONS.has(ext) || type === "application/json") {
    const raw = data.toString("utf8").replace(/^\uFEFF/, "");
    if (raw.includes("\u0000")) throw new AttachmentError(`${safeName} doesn't look like a text file.`);
    const { text, truncated } = truncateLines(raw);
    const lines = raw.split("\n").length;
    return {
      name: safeName,
      kind: "text",
      summary: `${lines} line${lines === 1 ? "" : "s"}${truncated ? ", truncated" : ""}`,
      text,
      ...(truncated ? { truncated } : {}),
    };
  }

  const imageMime =
    IMAGE_MIME[ext] ||
    (type.startsWith("image/") && Object.values(IMAGE_MIME).includes(type) ? type : null);
  if (imageMime) {
    if (data.length > MAX_IMAGE_BYTES) {
      throw new AttachmentError(`${safeName} is larger than 4 MB. Send a smaller photo.`);
    }
    return {
      name: safeName,
      kind: "image",
      summary: `${Math.max(1, Math.round(data.length / 1024))} KB · ${imageMime.replace("image/", "")}`,
      text: "",
      mimeType: imageMime,
      data: data.toString("base64"),
    };
  }
  if (ext === "heic" || ext === "heif" || type.includes("heic") || type.includes("heif")) {
    throw new AttachmentError(`Save ${safeName} as JPEG or PNG first (HEIC isn't supported).`);
  }
  throw new AttachmentError(
    `${safeName}: only photos (JPEG/PNG/GIF/WebP), spreadsheets (.xlsx, .csv, .tsv), and text files are supported. For a Google Sheet, paste its link.`,
  );
}

/** Validate attachments echoed back by the browser before they reach the model. */
export function sanitizeAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  const out: ChatAttachment[] = [];
  for (const a of input.slice(0, MAX_ATTACHMENTS)) {
    if (!a || typeof a.name !== "string") continue;
    const name = a.name.replace(/[\r\n"]/g, " ").slice(0, 120);
    const summary = typeof a.summary === "string" ? a.summary.slice(0, 80) : "";
    if (a.kind === "image" && typeof a.data === "string" && typeof a.mimeType === "string") {
      const mimeType = a.mimeType.toLowerCase();
      if (!Object.values(IMAGE_MIME).includes(mimeType)) continue;
      if (a.data.length > MAX_IMAGE_BYTES * 2) continue;
      out.push({ name, kind: "image", summary, text: "", mimeType, data: a.data });
      continue;
    }
    if (typeof a.text !== "string") continue;
    out.push({
      name,
      kind: a.kind === "sheet" ? "sheet" : "text",
      summary,
      ...truncateLines(a.text),
    });
  }
  return out;
}
