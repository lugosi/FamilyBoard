import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import {
  DEFAULT_BOARD_SETTINGS,
  mergeBoardSettings,
  normalizeBoardSettings,
  type BoardSettings,
} from "./board-settings";

const SETTINGS_FILE = "board-settings.json";

export async function readBoardSettings(): Promise<BoardSettings> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), SETTINGS_FILE), "utf-8");
    return normalizeBoardSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_BOARD_SETTINGS };
  }
}

export async function updateBoardSettings(patch: unknown): Promise<BoardSettings> {
  const next = mergeBoardSettings(await readBoardSettings(), patch);
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), SETTINGS_FILE),
    JSON.stringify(next, null, 2),
    "utf-8",
  );
  return next;
}
