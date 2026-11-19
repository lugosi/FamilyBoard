/** Client-safe board widget order / visibility helpers (no Node fs). */

export const BOARD_WIDGET_KEYS = [
  "clock",
  "weather",
  "catlink",
  "petlibro",
  "spotify",
  "hue",
  "nest",
] as const;

export type BoardWidgetKey = (typeof BOARD_WIDGET_KEYS)[number];

export const BOARD_WIDGET_META: Record<
  BoardWidgetKey,
  { title: string; short: string }
> = {
  clock: { title: "Clock", short: "Time" },
  weather: { title: "Weather", short: "Wx" },
  catlink: { title: "Catlink", short: "Litter" },
  petlibro: { title: "Petlibro", short: "Diet" },
  spotify: { title: "Spotify", short: "Music" },
  hue: { title: "Hue", short: "Lights" },
  nest: { title: "Indoor", short: "Climate" },
};

export type BoardWidgetLayout = {
  order: BoardWidgetKey[];
  enabled: Record<BoardWidgetKey, boolean>;
};

export function defaultBoardWidgetLayout(): BoardWidgetLayout {
  return {
    order: [...BOARD_WIDGET_KEYS],
    enabled: Object.fromEntries(BOARD_WIDGET_KEYS.map((k) => [k, true])) as Record<
      BoardWidgetKey,
      boolean
    >,
  };
}

function isWidgetKey(v: unknown): v is BoardWidgetKey {
  return typeof v === "string" && (BOARD_WIDGET_KEYS as readonly string[]).includes(v);
}

export function normalizeBoardWidgetLayout(raw: unknown): BoardWidgetLayout {
  const defaults = defaultBoardWidgetLayout();
  if (!raw || typeof raw !== "object") return defaults;
  const o = raw as Record<string, unknown>;

  const seen = new Set<BoardWidgetKey>();
  const order: BoardWidgetKey[] = [];
  if (Array.isArray(o.order)) {
    for (const item of o.order) {
      if (isWidgetKey(item) && !seen.has(item)) {
        order.push(item);
        seen.add(item);
      }
    }
  }
  for (const key of BOARD_WIDGET_KEYS) {
    if (!seen.has(key)) order.push(key);
  }

  const enabled = { ...defaults.enabled };
  if (o.enabled && typeof o.enabled === "object" && !Array.isArray(o.enabled)) {
    for (const key of BOARD_WIDGET_KEYS) {
      const v = (o.enabled as Record<string, unknown>)[key];
      if (typeof v === "boolean") enabled[key] = v;
    }
  }

  return { order, enabled };
}

export function boardColumnKeys(layout: BoardWidgetLayout): BoardWidgetKey[] {
  return layout.order.filter((k) => layout.enabled[k]);
}

export function moveBoardWidget(
  layout: BoardWidgetLayout,
  key: BoardWidgetKey,
  direction: "up" | "down",
): BoardWidgetLayout {
  const order = [...layout.order];
  const i = order.indexOf(key);
  if (i < 0) return layout;
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return layout;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...layout, order };
}

export function setBoardWidgetEnabled(
  layout: BoardWidgetLayout,
  key: BoardWidgetKey,
  enabled: boolean,
): BoardWidgetLayout {
  return {
    ...layout,
    enabled: { ...layout.enabled, [key]: enabled },
  };
}
