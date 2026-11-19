// node --test scripts/fetch-url.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertPublicHttpUrl,
  fetchPublicUrl,
  htmlToReadableText,
} from "../src/lib/fetch-url.ts";

test("assertPublicHttpUrl accepts https public hosts", () => {
  const url = assertPublicHttpUrl("https://example.com/schedule?week=1");
  assert.equal(url.hostname, "example.com");
  assert.equal(url.protocol, "https:");
});

test("assertPublicHttpUrl blocks private and local hosts", () => {
  for (const bad of [
    "http://localhost/x",
    "http://127.0.0.1/",
    "http://192.168.1.5/a",
    "http://10.0.0.2/",
    "http://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "ftp://example.com/",
  ]) {
    assert.throws(() => assertPublicHttpUrl(bad), Error);
  }
});

test("htmlToReadableText strips scripts and keeps title", () => {
  const { title, text } = htmlToReadableText(`<!doctype html>
<html><head><title>Gym &amp; Classes</title>
<script>alert(1)</script><style>.x{}</style></head>
<body><h1>Monday</h1><p>HIIT 6:00 PM</p><div>Yoga 7:00</div></body></html>`);
  assert.equal(title, "Gym & Classes");
  assert.match(text, /Monday/);
  assert.match(text, /HIIT 6:00 PM/);
  assert.match(text, /Yoga 7:00/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /\.x\{\}/);
});

test("fetchPublicUrl returns text from mocked HTML", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<html><head><title>Schedule</title></head><body><p>Spin 8am</p></body></html>`,
      {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  try {
    const result = await fetchPublicUrl("https://gym.example/classes");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.title, "Schedule");
      assert.match(result.text, /Spin 8am/);
      assert.equal(result.contentType, "text/html");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchPublicUrl blocks redirect to private host", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/secret" },
    });
  try {
    const result = await fetchPublicUrl("https://evil.example/bounce");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /private_host_blocked|redirect/);
  } finally {
    globalThis.fetch = original;
  }
});

test("agent wires fetch_url tool and prompt guidance", () => {
  const src = readFileSync(new URL("../src/lib/agent.ts", import.meta.url), "utf8");
  assert.match(src, /from "\.\/fetch-url"/);
  assert.match(src, /name: "fetch_url"/);
  assert.match(src, /call fetch_url/);
});

test("slack treat fetch_url as read-only", () => {
  const src = readFileSync(new URL("../src/lib/slack-bot.ts", import.meta.url), "utf8");
  assert.match(src, /"fetch_url"/);
});
