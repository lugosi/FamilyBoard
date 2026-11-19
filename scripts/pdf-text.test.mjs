// node --test scripts/pdf-text.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  cleanPdfExtractedText,
  extractPdfText,
  isPdfMimeOrName,
} from "../src/lib/pdf-text.ts";

const fixture = readFileSync(new URL("./fixtures/hello.pdf", import.meta.url));

test("isPdfMimeOrName detects mime and .pdf names", () => {
  assert.equal(isPdfMimeOrName("application/pdf", "x"), true);
  assert.equal(isPdfMimeOrName("application/pdf; charset=binary", ""), true);
  assert.equal(isPdfMimeOrName("application/octet-stream", "schedule.PDF"), true);
  assert.equal(isPdfMimeOrName("text/html", "page.html"), false);
});

test("cleanPdfExtractedText drops page footers", () => {
  assert.equal(cleanPdfExtractedText("Hello\n\n-- 1 of 1 --\n\n"), "Hello");
});

test("extractPdfText reads fixture", async () => {
  const pdf = await extractPdfText(fixture);
  assert.match(pdf.text, /Hello FamilyBoard/);
  assert.equal(pdf.pages, 1);
  assert.doesNotMatch(pdf.text, /--\s*1 of 1/);
});

test("extractPdfText reads TriFit schedule PDF", async () => {
  const { readFileSync: read } = await import("node:fs");
  const trifitPath = "/tmp/pdf-debug/trifit.pdf";
  let data;
  try {
    data = read(trifitPath);
  } catch {
    // Offline CI without the downloaded schedule — skip.
    return;
  }
  const pdf = await extractPdfText(data);
  assert.match(pdf.text, /HIIT|Yoga|Functional Training/i);
  assert.ok(pdf.text.length > 200);
});

test("attachments, fetch_url, and chat UI wire PDF support via unpdf", () => {
  const attachments = readFileSync(new URL("../src/lib/attachments.ts", import.meta.url), "utf8");
  assert.match(attachments, /extractPdfText/);
  assert.match(attachments, /PDFs/);
  const pdfText = readFileSync(new URL("../src/lib/pdf-text.ts", import.meta.url), "utf8");
  assert.match(pdfText, /from "unpdf"|import\("unpdf"\)/);
  assert.doesNotMatch(pdfText, /pdf-parse/);
  const fetchUrl = readFileSync(new URL("../src/lib/fetch-url.ts", import.meta.url), "utf8");
  assert.match(fetchUrl, /extractPdfText/);
  assert.match(fetchUrl, /application\/pdf/);
  const agent = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(agent, /PDFs extracted to text/);
  const ui = readFileSync(new URL("../src/components/WikiLlm.tsx", import.meta.url), "utf8");
  assert.match(ui, /\.pdf/);
  assert.match(ui, /application\/pdf/);
});
