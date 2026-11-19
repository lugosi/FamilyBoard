/**
 * Extract readable text from a PDF buffer (chat uploads + fetch_url).
 * Uses pdf-parse on demand so optional dependency failures stay local.
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

/** Strip pdf-parse page footers like `-- 1 of 3 --`. */
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

/**
 * Parse PDF bytes → plain text. Throws Error with message:
 * not_a_pdf | pdf_no_text | pdf_parse_failed
 */
export async function extractPdfText(data: Buffer): Promise<PdfTextResult> {
  if (!looksLikePdf(data)) {
    throw new Error("not_a_pdf");
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const textResult = await parser.getText();
    let title: string | undefined;
    try {
      const infoResult = await parser.getInfo();
      const rawTitle = (infoResult?.info as { Title?: unknown } | undefined)?.Title;
      if (typeof rawTitle === "string" && rawTitle.trim()) {
        title = rawTitle.trim().slice(0, 200);
      }
    } catch {
      /* title optional */
    }
    const text = cleanPdfExtractedText(textResult.text || "");
    const pages =
      typeof textResult.total === "number" && textResult.total > 0
        ? textResult.total
        : Math.max(1, textResult.pages?.length || 1);
    if (!text) throw new Error("pdf_no_text");
    return { text, pages, title };
  } catch (e) {
    if (e instanceof Error && (e.message === "not_a_pdf" || e.message === "pdf_no_text")) {
      throw e;
    }
    throw new Error("pdf_parse_failed");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
