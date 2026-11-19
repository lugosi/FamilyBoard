import type { AgentTool } from "./agent";
import { fetchCatlinkSnapshot, getCatlinkConfig } from "./catlink";
import {
  chartsFromCatDietHistory,
  listCatDietHistory,
  summarizeCatDietHistory,
} from "./cat-diet-history";
import {
  fetchPetlibroSnapshot,
  getPetlibroConfig,
  type PetlibroSnapshot,
} from "./petlibro";

async function optionalCatlinkContext(): Promise<{
  linked: boolean;
  catName?: string;
  catWeightKg?: number;
  peeCountToday?: number;
  poopCountToday?: number;
  error?: string;
}> {
  if (!(await getCatlinkConfig())) return { linked: false };
  try {
    const snap = await fetchCatlinkSnapshot();
    return {
      linked: true,
      catName: snap.catName,
      catWeightKg: snap.catWeightKg,
      peeCountToday: snap.peeCountToday,
      poopCountToday: snap.poopCountToday,
    };
  } catch (e) {
    return {
      linked: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function dietHints(
  snapshot: PetlibroSnapshot,
  catWeightKg: number | undefined,
  history: ReturnType<typeof summarizeCatDietHistory>,
): string[] {
  const hints: string[] = [];
  const food = snapshot.totalFoodAmountToday;
  const unit = snapshot.totalFoodUnit || "cups";
  const waterMl = snapshot.totalWaterMlToday;

  if (typeof food === "number") {
    hints.push(`Food dispensed today: ${food} ${unit} (device total, may be shared).`);
  }
  if (typeof waterMl === "number") {
    hints.push(`Water recorded today: ${Math.round(waterMl)} ml.`);
    if (waterMl < 50) {
      hints.push(
        "Water intake looks low vs typical adult-cat guidance (~50–70+ ml/kg/day). Confirm fountain reporting and wet-food moisture.",
      );
    }
  }
  if (typeof catWeightKg === "number" && catWeightKg > 0 && typeof waterMl === "number") {
    const mlPerKg = waterMl / catWeightKg;
    hints.push(
      `Approx ${mlPerKg.toFixed(0)} ml water per kg body weight today (fountain only).`,
    );
  }
  if (history.dayCount >= 2) {
    if (history.averages.foodAmount != null) {
      hints.push(
        `${history.dayCount}-day avg food: ${history.averages.foodAmount} ${history.averages.foodUnit || unit}.`,
      );
    }
    if (history.averages.waterMl != null) {
      hints.push(`${history.dayCount}-day avg water: ${history.averages.waterMl} ml.`);
    }
    if (history.deltas.weightKg != null) {
      const sign = history.deltas.weightKg > 0 ? "+" : "";
      hints.push(
        `Weight change over stored days: ${sign}${history.deltas.weightKg} kg.`,
      );
    }
  } else {
    hints.push(
      "History is still short — FamilyBoard stores up to 30 local days as the board/agent polls (plus an hourly background sync).",
    );
  }
  hints.push(
    "This is household device data, not a vet diagnosis. Adjust for multiple pets, free-feeding leftovers, and wet food water content.",
  );
  return hints;
}

export async function petlibroToolsAvailable(): Promise<boolean> {
  return Boolean(await getPetlibroConfig());
}

export function buildPetlibroTools(ready: boolean): AgentTool[] {
  if (!ready) return [];

  return [
    {
      declaration: {
        name: "petlibro_consumption",
        description:
          "Fetch today's Petlibro food/water plus CatLink weight when linked, update the local 30-day diet history, and return averages/deltas for diet advice. Use for ate/drank, portions, hydration, weight trends, or adjusting diet.",
        parameters: { type: "object", properties: {} },
      },
      async run() {
        const [snapshot, catlink] = await Promise.all([
          fetchPetlibroSnapshot(),
          optionalCatlinkContext(),
        ]);
        const byDay = await listCatDietHistory();
        const history = summarizeCatDietHistory(byDay);
        const charts = chartsFromCatDietHistory(byDay);
        const hints = dietHints(snapshot, catlink.catWeightKg, history);
        return {
          response: {
            petlibro: snapshot,
            catlink: catlink.linked ? catlink : { linked: false },
            history,
            adviceHints: hints,
            chartHints: charts.map((c) => c.title).filter(Boolean),
          },
          label: "Petlibro consumption + history",
          charts,
        };
      },
    },
  ];
}
