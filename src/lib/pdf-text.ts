/**
 * Extract readable text from a PDF buffer (chat uploads + fetch_url).
 * Uses unpdf (serverless PDF.js) — no DOM / @napi-rs/canvas, works in Next standalone.
 */

export type PdfTextResult = {
  text: string;
  pages: number;
  title?: string;
};

function looksLikePdf(data: Buffer): boolean {
  if (data.length < 5) return false;
  // Allow a small BOM/whitespace prefix before %PDF-
  const head = data.subarray(0, Math.min(1024, data.length)).toString("latin1");
  return head.includes("%PDF-");
}

/** Normalize extracted PDF text for the model. */
export function cleanPdfExtractedText(raw: string): string {
  return raw
    .replace(/\n*--\s*\d+\s+of\s+\d+\s*--\s*/gi, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isPdfMimeOrName(mime: string, nameOrUrl = ""): boolean {
  const type = mime.toLowerCase().split(";")[0].trim();
  if (type === "application/pdf" || type === "application/x-pdf") return true;
  const path = nameOrUrl.toLowerCase().split("?")[0].split("#")[0];
  return path.endsWith(".pdf");
}

function failureCode(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not_a_pdf|Invalid PDF/i.test(msg)) return "not_a_pdf";
  if (/pdf_no_text/i.test(msg)) return "pdf_no_text";
  // Surface common Next/standalone canvas/DOM fallout as a stable code.
  if (/DOM|canvas|DOMMatrix|OffscreenCanvas|document is not defined/i.test(msg)) {
    return "pdf_dom_unavailable";
  }
  return "pdf_parse_failed";
}

/**
 * Parse PDF bytes → plain text. Throws Error with message:
 * not_a_pdf | pdf_no_text | pdf_dom_unavailable | pdf_parse_failed
 */
export async function extractPdfText(data: Buffer): Promise<PdfTextResult> {
  if (!looksLikePdf(data)) {
    throw new Error("not_a_pdf");
  }
  // Copy into a standalone Uint8Array — PDF.js may detach the underlying buffer.
  const bytes = Uint8Array.from(data);
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    const raw = typeof result.text === "string" ? result.text : "";
    const text = cleanPdfExtractedText(raw);
    const pages =
      typeof result.totalPages === "number" && result.totalPages > 0
        ? result.totalPages
        : 1;
    if (!text) throw new Error("pdf_no_text");
    return { text, pages };
  } catch (e) {
    if (e instanceof Error && (e.message === "not_a_pdf" || e.message === "pdf_no_text")) {
      throw e;
    }
    throw new Error(failureCode(e));
  }
}
