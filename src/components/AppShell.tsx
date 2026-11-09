"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Board } from "@/components/Board";
import { OnekoCat } from "@/components/OnekoCat";
import { WikiLlm } from "@/components/WikiLlm";

export type AppTab = "board" | "ai";

const TAB_STORAGE_KEY = "familyboard-tab";

function parseTab(raw: string | null | undefined): AppTab | null {
  if (raw === "board" || raw === "ai") return raw;
  return null;
}

// Query wins, else localStorage. Do not router.replace — URL changes can
// re-trigger Chrome cert / "not private" interstitials on LAN HTTPS.
function readInitialTab(): AppTab {
  try {
    const fromQuery = parseTab(
      new URLSearchParams(window.location.search).get("tab"),
    );
    if (fromQuery) return fromQuery;
  } catch {
    /* ignore */
  }
  try {
    return parseTab(localStorage.getItem(TAB_STORAGE_KEY)) ?? "board";
  } catch {
    return "board";
  }
}

const subscribeNoop = () => () => {};

export function AppShell() {
  // Server snapshot is always Board so SSR markup is stable; client snapshot
  // reads ?tab= / localStorage. Picked tab overrides after the user clicks.
  const storedTab = useSyncExternalStore(subscribeNoop, readInitialTab, () => "board");
  const [pickedTab, setPickedTab] = useState<AppTab | null>(null);
  const tab = pickedTab ?? storedTab;

  const selectTab = useCallback((next: AppTab) => {
    setPickedTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <nav
        className="relative z-40 flex shrink-0 items-center border-b border-slate-800 bg-slate-950/90 px-2 py-1.5 sm:px-4"
        aria-label="Main"
      >
        <div className="inline-flex rounded-md border border-slate-800 bg-slate-900/80 p-0.5">
          {(
            [
              { id: "board" as const, label: "Board" },
              { id: "ai" as const, label: "AI" },
            ] as const
          ).map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                className={`rounded-md px-3.5 py-1.5 text-base font-semibold tracking-wide ${
                  active
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>
      </nav>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Keep both mounted so Board does not remount/blank on every tab switch */}
        <div
          className={
            tab === "board"
              ? "h-full min-h-0"
              : "pointer-events-none invisible absolute inset-0 h-full min-h-0"
          }
          aria-hidden={tab !== "board"}
        >
          <Board />
        </div>
        <div
          className={
            tab === "ai"
              ? "h-full min-h-0"
              : "pointer-events-none invisible absolute inset-0 h-full min-h-0"
          }
          aria-hidden={tab !== "ai"}
        >
          <WikiLlm active={tab === "ai"} />
        </div>
      </div>
      {/* Outside tab panels so the cat stays on Board and AI. */}
      <OnekoCat enabled />
    </div>
  );
}
