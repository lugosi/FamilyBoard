import fs from "fs/promises";
import path from "path";
import { getDataDir } from "./data-dir";

const HISTORY_FILE = "nest-climate-history.json";
const HISTORY_MS = 12 * 60 * 60 * 1000;
const MAX_SAMPLES = 720;
const MIN_GAP_MS = 45_000;

export type ClimateHistorySample = {
  t: number;
  temperatureF: number | null;
  humidity: number | null;
};

type HistoryFile = {
  samples: ClimateHistorySample[];
};

async function readHistoryFile(): Promise<HistoryFile> {
  const file = path.join(getDataDir(), HISTORY_FILE);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const data = JSON.parse(raw) as HistoryFile;
    if (!Array.isArray(data.samples)) return { samples: [] };
    return {
      samples: data.samples.filter(
        (s) =>
          typeof s.t === "number" &&
          Number.isFinite(s.t) &&
          (s.temperatureF === null || Number.isFinite(s.temperatureF)) &&
          (s.humidity === null || Number.isFinite(s.humidity)),
      ),
    };
  } catch {
    return { samples: [] };
  }
}

function prune(samples: ClimateHistorySample[]): ClimateHistorySample[] {
  const cutoff = Date.now() - HISTORY_MS;
  return samples.filter((s) => s.t >= cutoff).slice(-MAX_SAMPLES);
}

export async function appendClimateSample(sample: {
  temperatureF: number | null;
  humidity: number | null;
}): Promise<void> {
  const hasTemp = Number.isFinite(sample.temperatureF);
  const hasHum = Number.isFinite(sample.humidity);
  if (!hasTemp && !hasHum) return;

  const file = await readHistoryFile();
  const now = Date.now();
  const last = file.samples[file.samples.length - 1];
  if (last && now - last.t < MIN_GAP_MS) {
    last.temperatureF = hasTemp ? sample.temperatureF : last.temperatureF;
    last.humidity = hasHum ? sample.humidity : last.humidity;
    last.t = now;
  } else {
    file.samples.push({
      t: now,
      temperatureF: hasTemp ? sample.temperatureF : null,
      humidity: hasHum ? sample.humidity : null,
    });
  }

  const pruned = prune(file.samples);
  const out = path.join(getDataDir(), HISTORY_FILE);
  await fs.writeFile(out, JSON.stringify({ samples: pruned }, null, 2), "utf-8");
}

export async function getClimateHistory12h(): Promise<ClimateHistorySample[]> {
  const file = await readHistoryFile();
  return prune(file.samples);
}
