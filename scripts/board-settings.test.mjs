import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  BOARD_THEMES,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  mergeBoardSettings,
  normalizeBoardSettings,
  resolveGeminiModelId,
} from "../src/lib/board-settings.ts";

test("default Gemini model is 3.5 flash-lite and listed", () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.ok(GEMINI_MODEL_OPTIONS.some((m) => m.id === DEFAULT_GEMINI_MODEL));
});

test("normalizeBoardSettings falls back to defaults", () => {
  assert.deepEqual(normalizeBoardSettings(null), DEFAULT_BOARD_SETTINGS);
  assert.deepEqual(
    normalizeBoardSettings({ geminiModel: "evil/../model", theme: "nope", nightMode: "yes" }),
    DEFAULT_BOARD_SETTINGS,
  );
});

test("mergeBoardSettings applies valid fields and keeps current on invalid", () => {
  const current = { geminiModel: "gemini-3.6-flash", nightMode: false, theme: "forest" };
  assert.deepEqual(mergeBoardSettings(current, { nightMode: true }), {
    ...current,
    nightMode: true,
  });
  assert.deepEqual(mergeBoardSettings(current, { theme: "bogus", geminiModel: "x" }), current);
  assert.equal(mergeBoardSettings(current, { geminiModel: null }).geminiModel, null);
  assert.equal(mergeBoardSettings(current, { geminiModel: "" }).geminiModel, null);
});

test("resolveGeminiModelId: setting beats env beats default", () => {
  assert.equal(resolveGeminiModelId({ geminiModel: "gemini-3.8-flash" }, "gemini-4-hydrogen"), "gemini-3.8-flash");
  assert.equal(resolveGeminiModelId({ geminiModel: null }, " gemini-4-hydrogen "), "gemini-4-hydrogen");
  assert.equal(resolveGeminiModelId({ geminiModel: null }, ""), DEFAULT_GEMINI_MODEL);
  assert.equal(resolveGeminiModelId({ geminiModel: null }, undefined), DEFAULT_GEMINI_MODEL);
});

test("every non-default theme has CSS variables in globals.css", () => {
  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf-8");
  for (const t of BOARD_THEMES) {
    if (t.id === "slate") continue;
    assert.ok(css.includes(`html[data-theme="${t.id}"]`), `missing CSS for theme ${t.id}`);
  }
});
