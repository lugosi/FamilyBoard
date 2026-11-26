import { NextResponse } from "next/server";
import { isGeminiConfigured } from "@/lib/gemini";
import {
  BOARD_THEMES,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  resolveGeminiModelId,
} from "@/lib/board-settings";
import {
  readBoardSettings,
  updateBoardSettings,
} from "@/lib/board-settings-store";

async function snapshot(settings?: Awaited<ReturnType<typeof readBoardSettings>>) {
  const current = settings ?? (await readBoardSettings());
  const envModel = process.env.GEMINI_MODEL?.trim() || null;
  return {
    settings: current,
    effectiveGeminiModel: resolveGeminiModelId(current, envModel),
    envGeminiModel: envModel,
    defaultGeminiModel: DEFAULT_GEMINI_MODEL,
    geminiConfigured: isGeminiConfigured(),
    geminiModels: GEMINI_MODEL_OPTIONS,
    themes: BOARD_THEMES,
  };
}

export async function GET() {
  return NextResponse.json(await snapshot());
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const settings = await updateBoardSettings(body);
  return NextResponse.json(await snapshot(settings));
}
