// node --test scripts/amazon-link.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amazonProductSearchUrl,
  extractUrlFromText,
  looksLikeHttpUrl,
} from "../src/lib/amazon-link.ts";

test("amazonProductSearchUrl encodes the query", () => {
  assert.equal(
    amazonProductSearchUrl("AirPods Pro 2"),
    "https://www.amazon.com/s?k=AirPods%20Pro%202",
  );
});

test("looksLikeHttpUrl accepts https only as full URL strings", () => {
  assert.equal(looksLikeHttpUrl("https://www.amazon.com/s?k=x"), true);
  assert.equal(looksLikeHttpUrl("not a url"), false);
  assert.equal(looksLikeHttpUrl(""), false);
});

test("extractUrlFromText finds markdown and bare links", () => {
  assert.equal(
    extractUrlFromText("[AirPods](https://www.amazon.com/dp/B0EXAMPLE)"),
    "https://www.amazon.com/dp/B0EXAMPLE",
  );
  assert.equal(
    extractUrlFromText("see https://www.amazon.com/s?k=airpods please"),
    "https://www.amazon.com/s?k=airpods",
  );
  assert.equal(extractUrlFromText("no link here"), undefined);
});
