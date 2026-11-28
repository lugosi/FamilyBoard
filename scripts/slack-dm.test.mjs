// node --test scripts/slack-dm.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { slackChannelIsUserId } from "../src/lib/slack.ts";

test("DM delivery treats member ids as users and channel ids as channels", () => {
  assert.equal(slackChannelIsUserId("U012ABCDEF"), true);
  assert.equal(slackChannelIsUserId("W012ABCDEF"), true);
  assert.equal(slackChannelIsUserId("D012ABCDEF"), false);
  assert.equal(slackChannelIsUserId("C012ABCDEF"), false);
});

test("posting to a member id opens the DM channel first", () => {
  const src = readFileSync(new URL("../src/lib/slack.ts", import.meta.url), "utf8");
  assert.match(src, /conversations\.open/);
  assert.match(src, /if \(slackChannelIsUserId\(channel\)\)/);
});
