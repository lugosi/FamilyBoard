// node --test scripts/slack-dm.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchSlackMember, slackChannelIsUserId, slackMemberLabel } from "../src/lib/slack.ts";

test("DM delivery treats member ids as users and channel ids as channels", () => {
  assert.equal(slackChannelIsUserId("U012ABCDEF"), true);
  assert.equal(slackChannelIsUserId("W012ABCDEF"), true);
  assert.equal(slackChannelIsUserId("D012ABCDEF"), false);
  assert.equal(slackChannelIsUserId("C012ABCDEF"), false);
});

test("posting to a member id opens the app DM, not Slackbot", () => {
  const src = readFileSync(new URL("../src/lib/slack.ts", import.meta.url), "utf8");
  assert.match(src, /conversations\.open/);
  assert.match(src, /if \(slackChannelIsUserId\(channel\)\)/);
  assert.match(src, /id\.startsWith\("D"\)/);
  assert.match(src, /users\.list/);
});

test("member labels prefer a display name over the id", () => {
  assert.equal(
    slackMemberLabel({
      id: "U012ABCDEF",
      name: "maya",
      profile: { display_name: "Maya", real_name: "Maya Chen" },
    }),
    "Maya",
  );
  assert.equal(slackMemberLabel({ id: "U012ABCDEF", name: "U012ABCDEF" }), "");
  assert.equal(
    matchSlackMember(
      [{ id: "U012abCDEF", name: "Maya" }],
      "u012abcdef",
    )?.name,
    "Maya",
  );
});
