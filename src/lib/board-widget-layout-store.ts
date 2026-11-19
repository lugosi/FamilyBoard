import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";
import {
  defaultBoardWidgetLayout,
  normalizeBoardWidgetLayout,
  type BoardWidgetLayout,
} from "./board-widget-layout";

const LAYOUT_FILE = "board-widget-layout.json";

export async function readBoardWidgetLayout(): Promise<BoardWidgetLayout> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), LAYOUT_FILE), "utf-8");
    return normalizeBoardWidgetLayout(JSON.parse(raw));
  } catch {
    return defaultBoardWidgetLayout();
  }
}

export async function writeBoardWidgetLayout(
  layout: BoardWidgetLayout,
): Promise<BoardWidgetLayout> {
  const normalized = normalizeBoardWidgetLayout(layout);
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), LAYOUT_FILE),
    JSON.stringify(normalized, null, 2),
    "utf-8",
  );
  return normalized;
}
