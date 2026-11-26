"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BoardSettings,
  BoardThemeId,
} from "@/lib/board-settings";

export type BoardSettingsSnapshot = {
  settings: BoardSettings;
  effectiveGeminiModel: string;
  envGeminiModel: string | null;
  defaultGeminiModel: string;
  geminiConfigured: boolean;
  geminiModels: readonly { id: string; label: string; note: string }[];
  themes: readonly {
    id: BoardThemeId;
    label: string;
    swatch: { surface: string; accent: string };
  }[];
};

const REFRESH_MS = 60_000;

export function useBoardSettings() {
  const [snapshot, setSnapshot] = useState<BoardSettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/settings", { signal });
      if (!res.ok || signal?.aborted || savingRef.current) return;
      setSnapshot((await res.json()) as BoardSettingsSnapshot);
    } catch {
      /* keep last known settings */
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const first = window.setTimeout(() => void refresh(ac.signal), 0);
    const id = window.setInterval(() => void refresh(ac.signal), REFRESH_MS);
    return () => {
      ac.abort();
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [refresh]);

  const theme = snapshot?.settings.theme;
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
  }, [theme]);

  const update = useCallback(
    async (patch: Partial<BoardSettings>) => {
      const previous = snapshot;
      if (previous) {
        setSnapshot({
          ...previous,
          settings: { ...previous.settings, ...patch },
        });
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`Save failed (${res.status})`);
        setSnapshot((await res.json()) as BoardSettingsSnapshot);
      } catch (e) {
        setSnapshot(previous);
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [snapshot],
  );

  return { snapshot, settings: snapshot?.settings ?? null, error, saving, update };
}
