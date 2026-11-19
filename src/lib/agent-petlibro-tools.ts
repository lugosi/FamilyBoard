import type { AgentTool } from "./agent";
import { fetchCatlinkSnapshot, getCatlinkConfig } from "./catlink";
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

function dietHints(snapshot: PetlibroSnapshot, catWeightKg?: number): string[] {
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
      hints.push("Water intake looks low vs typical adult-cat guidance (~50–70+ ml/kg/day). Confirm fountain reporting and wet-food moisture.");
    }
  }
  if (typeof catWeightKg === "number" && catWeightKg > 0 && typeof waterMl === "number") {
    const mlPerKg = waterMl / catWeightKg;
    hints.push(`Approx ${mlPerKg.toFixed(0)} ml water per kg body weight today (fountain only).`);
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
          "Fetch today's Petlibro feeder food and fountain water consumption (and optional CatLink weight/toilet context) to advise on cat diet and hydration. Use when someone asks how much the cat ate/drank, diet advice, portions, or water intake.",
        parameters: { type: "object", properties: {} },
      },
      async run() {
        const [snapshot, catlink] = await Promise.all([
          fetchPetlibroSnapshot(),
          optionalCatlinkContext(),
        ]);
        const hints = dietHints(snapshot, catlink.catWeightKg);
        return {
          response: {
            petlibro: snapshot,
            catlink: catlink.linked ? catlink : { linked: false },
            adviceHints: hints,
          },
          label: "Petlibro consumption",
        };
      },
    },
  ];
}
