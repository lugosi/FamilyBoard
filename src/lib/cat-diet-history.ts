import fs from "fs/promises";
import path from "path";
import type { ChatChartSpec } from "./chat-chart";
import { getDataDir } from "./data-dir";
import { getDefaultTimeZone } from "./google";

const HISTORY_FILE = "cat-diet-history.json";
/**
 * Keep ~6 months of daily rows. Petlibro cloud water history retains ~170 days;
 * our file is the durable archive beyond that rolling window.
 */
export const CAT_DIET_HISTORY_DAYS = 180;
const HISTORY_DAYS = CAT_DIET_HISTORY_DAYS;
/** Chart renderer caps series length; bucket to weeks when longer. */
const CHART_MAX_POINTS = 24;

export type CatDietDaySample = {
  /** Local calendar day YYYY-MM-DD in DEFAULT_TIMEZONE. */
  dateKey: string;
  catName?: string;
  catWeightKg?: number;
  foodAmount?: number;
  foodUnit?: string;
  foodPortions?: number;
  foodFeedTimes?: number;
  waterMl?: number;
  waterTimes?: number;
  peeCount?: number;
  poopCount?: number;
  updatedAt: string;
};

type HistoryFile = {
  days: CatDietDaySample[];
};

export function localDateKey(at = new Date(), timeZone = getDefaultTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function shortDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey.slice(5);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

async function readHistoryFile(): Promise<HistoryFile> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), HISTORY_FILE), "utf-8");
    const data = JSON.parse(raw) as HistoryFile;
    if (!Array.isArray(data.days)) return { days: [] };
    return {
      days: data.days.filter(
        (d) =>
          typeof d?.dateKey === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(d.dateKey) &&
          typeof d.updatedAt === "string",
      ),
    };
  } catch {
    return { days: [] };
  }
}

function prune(days: CatDietDaySample[], timeZone = getDefaultTimeZone()): CatDietDaySample[] {
  const today = localDateKey(new Date(), timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const todayUtc = Date.UTC(y, m - 1, d);
  const cutoff = todayUtc - (HISTORY_DAYS - 1) * 24 * 60 * 60 * 1000;
  return days
    .filter((row) => {
      const [ry, rm, rd] = row.dateKey.split("-").map(Number);
      return Date.UTC(ry, rm - 1, rd) >= cutoff;
    })
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

async function writeHistory(days: CatDietDaySample[]): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(
    path.join(getDataDir(), HISTORY_FILE),
    JSON.stringify({ days: prune(days) }, null, 2),
    "utf-8",
  );
}

export type CatDietSampleInput = {
  dateKey?: string;
  catName?: string;
  catWeightKg?: number;
  foodAmount?: number;
  foodUnit?: string;
  foodPortions?: number;
  foodFeedTimes?: number;
  waterMl?: number;
  waterTimes?: number;
  peeCount?: number;
  poopCount?: number;
};

function mergeNum(
  next: number | undefined,
  prev: number | undefined,
): number | undefined {
  return typeof next === "number" && Number.isFinite(next) ? next : prev;
}

/**
 * Upsert today's (or given) day row. Later samples overwrite fields so board
 * polls and the end-of-day background tick keep the latest cloud totals.
 */
export async function upsertCatDietDay(
  input: CatDietSampleInput,
): Promise<CatDietDaySample> {
  const timeZone = getDefaultTimeZone();
  const dateKey = input.dateKey || localDateKey(new Date(), timeZone);
  const file = await readHistoryFile();
  const existing = file.days.find((d) => d.dateKey === dateKey);
  const merged: CatDietDaySample = {
    dateKey,
    catName: input.catName?.trim() || existing?.catName,
    catWeightKg: mergeNum(input.catWeightKg, existing?.catWeightKg),
    foodAmount: mergeNum(input.foodAmount, existing?.foodAmount),
    foodUnit: input.foodUnit?.trim() || existing?.foodUnit,
    foodPortions: mergeNum(input.foodPortions, existing?.foodPortions),
    foodFeedTimes: mergeNum(input.foodFeedTimes, existing?.foodFeedTimes),
    waterMl: mergeNum(input.waterMl, existing?.waterMl),
    waterTimes: mergeNum(input.waterTimes, existing?.waterTimes),
    peeCount: mergeNum(input.peeCount, existing?.peeCount),
    poopCount: mergeNum(input.poopCount, existing?.poopCount),
    updatedAt: new Date().toISOString(),
  };

  const days = file.days.filter((d) => d.dateKey !== dateKey);
  days.push(merged);
  await writeHistory(days);
  return merged;
}

export async function listCatDietHistory(days = HISTORY_DAYS): Promise<CatDietDaySample[]> {
  const file = await readHistoryFile();
  const pruned = prune(file.days);
  return pruned.slice(-Math.max(1, Math.min(days, HISTORY_DAYS)));
}

export type CatDietHistorySummary = {
  windowDays: number;
  dayCount: number;
  latest?: CatDietDaySample;
  averages: {
    foodAmount?: number;
    foodUnit?: string;
    waterMl?: number;
    catWeightKg?: number;
  };
  deltas: {
    weightKg?: number | null;
    foodAmount?: number | null;
    waterMl?: number | null;
  };
  byDay: CatDietDaySample[];
};

function avg(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000;
}

export function summarizeCatDietHistory(
  byDay: CatDietDaySample[],
): CatDietHistorySummary {
  const foodUnit =
    [...byDay].reverse().find((d) => d.foodUnit)?.foodUnit || "cups";
  const foodVals = byDay
    .map((d) => d.foodAmount)
    .filter((n): n is number => typeof n === "number");
  const waterVals = byDay
    .map((d) => d.waterMl)
    .filter((n): n is number => typeof n === "number");
  const weightVals = byDay
    .map((d) => d.catWeightKg)
    .filter((n): n is number => typeof n === "number");

  const firstWeight = weightVals[0];
  const lastWeight = weightVals[weightVals.length - 1];
  const firstFood = foodVals[0];
  const lastFood = foodVals[foodVals.length - 1];
  const firstWater = waterVals[0];
  const lastWater = waterVals[waterVals.length - 1];

  return {
    windowDays: HISTORY_DAYS,
    dayCount: byDay.length,
    latest: byDay[byDay.length - 1],
    averages: {
      foodAmount: avg(foodVals),
      foodUnit,
      waterMl: avg(waterVals) != null ? Math.round(avg(waterVals)!) : undefined,
      catWeightKg: avg(weightVals),
    },
    deltas: {
      weightKg:
        firstWeight != null && lastWeight != null
          ? Math.round((lastWeight - firstWeight) * 1000) / 1000
          : null,
      foodAmount:
        firstFood != null && lastFood != null
          ? Math.round((lastFood - firstFood) * 1000) / 1000
          : null,
      waterMl:
        firstWater != null && lastWater != null
          ? Math.round(lastWater - firstWater)
          : null,
    },
    byDay,
  };
}

export async function recordPetlibroDietSample(snapshot: {
  totalFoodAmountToday?: number;
  totalFoodUnit?: string;
  totalFoodPortionsToday?: number;
  totalWaterMlToday?: number;
  totalWaterTimesToday?: number;
  devices?: Array<{
    kind: string;
    feeder?: { todayFeedingTimes?: number };
    fountain?: { yesterdayDrinkMl?: number; yesterdayDrinkTimes?: number };
  }>;
}): Promise<void> {
  const feedTimes = snapshot.devices
    ?.filter((d) => d.kind === "feeder")
    .reduce((sum, d) => sum + (d.feeder?.todayFeedingTimes ?? 0), 0);

  await upsertCatDietDay({
    foodAmount: snapshot.totalFoodAmountToday,
    foodUnit: snapshot.totalFoodUnit,
    foodPortions: snapshot.totalFoodPortionsToday,
    foodFeedTimes: feedTimes || undefined,
    waterMl: snapshot.totalWaterMlToday,
    waterTimes: snapshot.totalWaterTimesToday,
  });

  // Best-effort backfill yesterday's water from fountain cloud totals when we
  // don't already have a row (board may not have been open that day).
  const yesterdayWater = snapshot.devices
    ?.filter((d) => d.kind === "fountain")
    .reduce(
      (acc, d) => ({
        ml: acc.ml + (d.fountain?.yesterdayDrinkMl ?? 0),
        times: acc.times + (d.fountain?.yesterdayDrinkTimes ?? 0),
      }),
      { ml: 0, times: 0 },
    );
  if (yesterdayWater && (yesterdayWater.ml > 0 || yesterdayWater.times > 0)) {
    const timeZone = getDefaultTimeZone();
    const today = localDateKey(new Date(), timeZone);
    const [y, m, d] = today.split("-").map(Number);
    const yDay = new Date(Date.UTC(y, m - 1, d - 1));
    const yesterdayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(yDay);
    const existing = (await listCatDietHistory()).find((row) => row.dateKey === yesterdayKey);
    if (!existing || existing.waterMl == null) {
      await upsertCatDietDay({
        dateKey: yesterdayKey,
        waterMl: yesterdayWater.ml || undefined,
        waterTimes: yesterdayWater.times || undefined,
      });
    }
  }
}

export async function recordCatlinkDietSample(snapshot: {
  catName?: string;
  catWeightKg?: number;
  peeCountToday?: number;
  poopCountToday?: number;
}): Promise<void> {
  await upsertCatDietDay({
    catName: snapshot.catName,
    catWeightKg: snapshot.catWeightKg,
    peeCount: snapshot.peeCountToday,
    poopCount: snapshot.poopCountToday,
  });
}

const BACKFILL_MARKER = "cat-diet-backfill.json";

type BackfillMarker = {
  petlibroAt?: string;
  catlinkAt?: string;
  petlibroVersion?: number;
};

/** Bump when backfill window widens so existing installs re-pull. */
const BACKFILL_VERSION = 2;

async function readBackfillMarker(): Promise<BackfillMarker> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), BACKFILL_MARKER), "utf-8");
    return JSON.parse(raw) as BackfillMarker;
  } catch {
    return {};
  }
}

async function writeBackfillMarker(patch: BackfillMarker): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  const prev = await readBackfillMarker();
  await fs.writeFile(
    path.join(getDataDir(), BACKFILL_MARKER),
    JSON.stringify({ ...prev, ...patch }, null, 2),
    "utf-8",
  );
}

async function shouldRunPetlibroBackfill(): Promise<boolean> {
  const marker = await readBackfillMarker();
  if (marker.petlibroVersion === BACKFILL_VERSION && marker.petlibroAt) {
    if (Date.now() - Date.parse(marker.petlibroAt) < 12 * 60 * 60 * 1000) {
      return false;
    }
  }
  const days = await listCatDietHistory();
  const withWaterOrFood = days.filter(
    (d) => d.waterMl != null || d.foodAmount != null || d.foodPortions != null,
  );
  // Re-backfill until we have a healthy multi-month series (or version bumps).
  if (
    marker.petlibroVersion === BACKFILL_VERSION &&
    withWaterOrFood.length >= 60
  ) {
    return false;
  }
  return true;
}

async function shouldRunCatlinkBackfill(): Promise<boolean> {
  const marker = await readBackfillMarker();
  if (marker.petlibroVersion === BACKFILL_VERSION && marker.catlinkAt) {
    if (Date.now() - Date.parse(marker.catlinkAt) < 12 * 60 * 60 * 1000) {
      return false;
    }
  }
  const days = await listCatDietHistory();
  const withWeight = days.filter((d) => d.catWeightKg != null);
  if (marker.petlibroVersion === BACKFILL_VERSION && withWeight.length >= 45) {
    return false;
  }
  return true;
}

/** Pull live Petlibro + CatLink (when linked) and persist today's diet row. */
export async function syncCatDietHistory(): Promise<CatDietDaySample | null> {
  const { getPetlibroConfig, fetchPetlibroSnapshot, backfillPetlibroDietHistory } =
    await import("./petlibro");
  const { getCatlinkConfig, fetchCatlinkSnapshot, backfillCatlinkDietHistory } =
    await import("./catlink");

  let wrote: CatDietDaySample | null = null;
  if (await getPetlibroConfig()) {
    try {
      await fetchPetlibroSnapshot();
      if (await shouldRunPetlibroBackfill()) {
        await backfillPetlibroDietHistory({ months: 6 });
        await writeBackfillMarker({
          petlibroAt: new Date().toISOString(),
          petlibroVersion: BACKFILL_VERSION,
        });
      }
      wrote = (await listCatDietHistory()).at(-1) ?? null;
    } catch {
      /* keep going for catlink */
    }
  }
  if (await getCatlinkConfig()) {
    try {
      await fetchCatlinkSnapshot();
      try {
        if (await shouldRunCatlinkBackfill()) {
          await backfillCatlinkDietHistory({ days: 90 });
          await writeBackfillMarker({
            catlinkAt: new Date().toISOString(),
            petlibroVersion: BACKFILL_VERSION,
          });
        }
      } catch {
        /* weight backfill is best-effort */
      }
      wrote = (await listCatDietHistory()).at(-1) ?? null;
    } catch {
      /* ignore */
    }
  }
  return wrote;
}

function mondayWeekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + mondayOffset);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

function downsampleForChart(
  byDay: CatDietDaySample[],
): { points: CatDietDaySample[]; grain: "day" | "week" } {
  if (byDay.length <= CHART_MAX_POINTS) {
    return { points: byDay, grain: "day" };
  }
  const weeks = new Map<string, CatDietDaySample[]>();
  for (const row of byDay) {
    const key = mondayWeekKey(row.dateKey);
    const list = weeks.get(key) || [];
    list.push(row);
    weeks.set(key, list);
  }
  const points: CatDietDaySample[] = [];
  for (const [weekKey, rows] of [...weeks.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const foodVals = rows
      .map((r) => r.foodAmount)
      .filter((n): n is number => typeof n === "number");
    const waterVals = rows
      .map((r) => r.waterMl)
      .filter((n): n is number => typeof n === "number");
    const weightVals = rows
      .map((r) => r.catWeightKg)
      .filter((n): n is number => typeof n === "number");
    const foodUnit = [...rows].reverse().find((r) => r.foodUnit)?.foodUnit;
    points.push({
      dateKey: weekKey,
      foodAmount: foodVals.length
        ? Math.round((foodVals.reduce((a, b) => a + b, 0) / foodVals.length) * 1000) /
          1000
        : undefined,
      foodUnit,
      waterMl: waterVals.length
        ? Math.round(waterVals.reduce((a, b) => a + b, 0) / waterVals.length)
        : undefined,
      catWeightKg: weightVals.length
        ? Math.round(
            (weightVals.reduce((a, b) => a + b, 0) / weightVals.length) * 1000,
          ) / 1000
        : undefined,
      updatedAt: rows[rows.length - 1]?.updatedAt || new Date().toISOString(),
    });
  }
  return {
    points: points.slice(-CHART_MAX_POINTS),
    grain: "week",
  };
}

export function chartsFromCatDietHistory(
  byDay: CatDietDaySample[],
): ChatChartSpec[] {
  if (byDay.length < 2) return [];
  const { points, grain } = downsampleForChart(byDay);
  const labels = points.map((d) => shortDayLabel(d.dateKey));
  const foodUnit =
    [...points].reverse().find((d) => d.foodUnit)?.foodUnit ||
    [...byDay].reverse().find((d) => d.foodUnit)?.foodUnit ||
    "cups";
  const xLabel = grain === "week" ? "Week (Mon)" : "Day";
  const titleSuffix = grain === "week" ? "weekly avg" : "daily";

  const foodSeries = points.map((d, i) => ({
    label: labels[i],
    value: typeof d.foodAmount === "number" ? d.foodAmount : 0,
  }));
  const waterSeries = points.map((d, i) => ({
    label: labels[i],
    value: typeof d.waterMl === "number" ? d.waterMl : 0,
  }));
  const weightPoints = points
    .map((d, i) =>
      typeof d.catWeightKg === "number"
        ? { label: labels[i], value: d.catWeightKg }
        : null,
    )
    .filter((p): p is { label: string; value: number } => Boolean(p));

  const charts: ChatChartSpec[] = [
    {
      type: "combo",
      title: `Cat food & water (${titleSuffix})`,
      leftAxisLabel: `Food (${foodUnit})`,
      rightAxisLabel: "Water (ml)",
      xAxisLabel: xLabel,
      series: [
        { name: "Food", unit: foodUnit, color: "#fbbf24", data: foodSeries },
        { name: "Water", unit: "ml", color: "#38bdf8", data: waterSeries },
      ],
    },
  ];

  if (weightPoints.length >= 2) {
    charts.push({
      type: "line",
      title: `Cat weight (${titleSuffix}, kg)`,
      leftAxisLabel: "Weight (kg)",
      xAxisLabel: xLabel,
      unit: "kg",
      series: [{ name: "Weight", unit: "kg", color: "#34d399", data: weightPoints }],
    });
  }

  return charts;
}
