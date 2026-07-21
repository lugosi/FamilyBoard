"use client";

import { useCallback, useEffect, useState } from "react";
import { Board } from "@/components/Board";
import { WikiLlm } from "@/components/WikiLlm";

export type AppTab = "board" | "ai";

const TAB_STORAGE_KEY = "familyboard-tab";

function parseTab(raw: string | null | undefined): AppTab | null {
  if (raw === "board" || raw === "ai") return raw;
  return null;
}

export function AppShell() {
  const [tab, setTab] = useState<AppTab>("board");
  const [ready, setReady] = useState(false);

  // Read initial tab once (query wins, else localStorage). Do not router.replace —
  // URL changes can re-trigger Chrome cert / "not private" interstitials on LAN HTTPS.
  useEffect(() => {
    let fromQuery: AppTab | null = null;
    try {
      fromQuery = parseTab(
        new URLSearchParams(window.location.search).get("tab"),
      );
    } catch {
      fromQuery = null;
    }
    if (fromQuery) {
      setTab(fromQuery);
      try {
        localStorage.setItem(TAB_STORAGE_KEY, fromQuery);
      } catch {
        /* ignore */
      }
    } else {
      try {
        const stored = parseTab(localStorage.getItem(TAB_STORAGE_KEY));
        if (stored) setTab(stored);
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, []);

  const selectTab = useCallback((next: AppTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-slate-950 text-slate-100">
      <nav
        className="flex shrink-0 items-center gap-1 border-b border-slate-800 bg-slate-950/90 px-2 py-1.5 sm:px-4"
        aria-label="Main"
      >
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
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold tracking-wide sm:text-base ${
                active
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {label}
            </button>
          );
        })}
      </nav>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Keep both mounted so Board does not remount/blank on every tab switch */}
        <div
          className={
            ready && tab === "board"
              ? "h-full min-h-0"
              : "pointer-events-none invisible absolute inset-0 h-full min-h-0"
          }
          aria-hidden={tab !== "board"}
        >
          <Board />
        </div>
        <div
          className={
            ready && tab === "ai"
              ? "h-full min-h-0"
              : "pointer-events-none invisible absolute inset-0 h-full min-h-0"
          }
          aria-hidden={tab !== "ai"}
        >
          <WikiLlm active={tab === "ai"} />
        </div>
      </div>
    </div>
  );
}
