import assert from "node:assert/strict";
import { test } from "node:test";
import { squashHueAreaName } from "../src/lib/hue-name.ts";

test("squashHueAreaName matches spoken room names to Hue groups", () => {
  assert.equal(squashHueAreaName("Living room"), "living");
  assert.equal(squashHueAreaName("the Living Room lights"), "living");
  assert.equal(squashHueAreaName("Kitchen"), "kitchen");
  assert.equal(squashHueAreaName("living"), squashHueAreaName("Living Room"));
});
