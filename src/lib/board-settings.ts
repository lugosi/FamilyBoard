/** Client-safe board settings (no fs). Persistence lives in board-settings-store.ts. */

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export const GEMINI_MODEL_OPTIONS = [
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    note: "Default — cheapest",
  },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Balanced" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Faster, smarter" },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    note: "Most capable — expensive",
  },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Legacy" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODEL_OPTIONS)[number]["id"];

export const BOARD_THEMES = [
  {
    id: "slate",
    label: "Slate",
    swatch: { surface: "#0f172a", accent: "#0ea5e9" },
  },
  {
    id: "midnight",
    label: "Midnight",
    swatch: { surface: "#14122e", accent: "#8b7cf6" },
  },
  {
    id: "forest",
    label: "Forest",
    swatch: { surface: "#0b1f17", accent: "#34c98a" },
  },
  {
    id: "ember",
    label: "Ember",
    swatch: { surface: "#1f150d", accent: "#f0922b" },
  },
  {
    id: "github",
    label: "GitHub Dark",
    swatch: { surface: "#0d1117", accent: "#1f6feb" },
  },
  {
    id: "plum",
    label: "Plum",
    swatch: { surface: "#1f1024", accent: "#e164b4" },
  },
] as const;

export type BoardThemeId = (typeof BOARD_THEMES)[number]["id"];

export const DEFAULT_BOARD_THEME: BoardThemeId = "slate";

export type BoardSettings = {
  /** null = use GEMINI_MODEL from the environment, else the built-in default. */
  geminiModel: GeminiModelId | null;
  /** Greyscale dimming between sunset (or 10pm) and sunrise (or 7am). */
  nightMode: boolean;
  theme: BoardThemeId;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  geminiModel: null,
  nightMode: true,
  theme: DEFAULT_BOARD_THEME,
};

export function isGeminiModelId(v: unknown): v is GeminiModelId {
  return (
    typeof v === "string" && GEMINI_MODEL_OPTIONS.some((m) => m.id === v)
  );
}

export function isBoardThemeId(v: unknown): v is BoardThemeId {
  return typeof v === "string" && BOARD_THEMES.some((t) => t.id === v);
}

/** Apply a partial patch on top of `current`; invalid fields keep the current value. */
export function mergeBoardSettings(
  current: BoardSettings,
  patch: unknown,
): BoardSettings {
  const next: BoardSettings = { ...current };
  if (!patch || typeof patch !== "object") return next;
  const p = patch as Record<string, unknown>;
  if ("geminiModel" in p) {
    if (p.geminiModel === null || p.geminiModel === "") next.geminiModel = null;
    else if (isGeminiModelId(p.geminiModel)) next.geminiModel = p.geminiModel;
  }
  if (typeof p.nightMode === "boolean") next.nightMode = p.nightMode;
  if (isBoardThemeId(p.theme)) next.theme = p.theme;
  return next;
}

export function normalizeBoardSettings(raw: unknown): BoardSettings {
  return mergeBoardSettings(DEFAULT_BOARD_SETTINGS, raw);
}

/** Selected model (UI/file) → GEMINI_MODEL env → built-in default. */
export function resolveGeminiModelId(
  settings: Pick<BoardSettings, "geminiModel">,
  envModel?: string | null,
): string {
  return settings.geminiModel ?? (envModel?.trim() || DEFAULT_GEMINI_MODEL);
}
