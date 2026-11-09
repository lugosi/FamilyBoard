"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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

function RobotIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <path d="M9 16.5h6" />
      <path d="M3.5 12.5h1.5M19 12.5h1.5" />
    </svg>
  );
}

export function AppShell() {
  // Server snapshot is always Board so SSR markup is stable; client snapshot
  // reads ?tab= / localStorage. Picked tab overrides after the user clicks.
  const storedTab = useSyncExternalStore(subscribeNoop, readInitialTab, () => "board");
  const [pickedTab, setPickedTab] = useState<AppTab | null>(null);
  const tab = pickedTab ?? storedTab;
  const [boardChatOpen, setBoardChatOpen] = useState(false);

  const selectTab = useCallback((next: AppTab) => {
    setPickedTab(next);
    if (next === "ai") setBoardChatOpen(false);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const openBoardChat = useCallback(() => setBoardChatOpen(true), []);
  const closeBoardChat = useCallback(() => setBoardChatOpen(false), []);

  useEffect(() => {
    if (!boardChatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setBoardChatOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardChatOpen]);

  const showAiPage = tab === "ai";
  const showAiOverlay = tab === "board" && boardChatOpen;
  const wikiActive = showAiPage || showAiOverlay;

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
        {tab === "board" ? (
          <button
            type="button"
            className="ml-2 inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/80 px-2.5 py-1.5 text-sm font-medium text-slate-200 hover:border-sky-500/60 hover:bg-slate-800 hover:text-white sm:ml-3 sm:px-3"
            onClick={openBoardChat}
            aria-label="Open assistant chat"
            title="Assistant"
          >
            <RobotIcon className="h-4 w-4 text-sky-300" />
            <span className="hidden sm:inline">Ask</span>
          </button>
        ) : null}
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
            showAiPage
              ? "h-full min-h-0"
              : showAiOverlay
                ? "absolute inset-0 z-50 flex items-stretch justify-center p-2 sm:items-center sm:p-4"
                : "pointer-events-none invisible absolute inset-0 h-full min-h-0"
          }
          aria-hidden={!wikiActive}
        >
          {showAiOverlay ? (
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px]"
              aria-label="Close assistant"
              onClick={closeBoardChat}
            />
          ) : null}
          <div
            className={
              showAiOverlay
                ? "relative z-10 flex h-full max-h-[min(92dvh,54rem)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-slate-700 bg-slate-950 shadow-2xl shadow-black/50 sm:h-[min(88dvh,52rem)]"
                : "h-full min-h-0"
            }
            role={showAiOverlay ? "dialog" : undefined}
            aria-modal={showAiOverlay ? true : undefined}
            aria-label={showAiOverlay ? "Assistant chat" : undefined}
          >
            <WikiLlm
              active={wikiActive}
              variant={showAiOverlay ? "overlay" : "page"}
              onClose={showAiOverlay ? closeBoardChat : undefined}
            />
          </div>
        </div>

        {tab === "board" && !boardChatOpen ? (
          <button
            type="button"
            className="absolute bottom-4 right-4 z-30 flex h-12 w-12 items-center justify-center rounded-md border border-slate-600 bg-sky-600 text-white shadow-lg shadow-sky-950/40 hover:bg-sky-500 sm:bottom-5 sm:right-5 sm:h-14 sm:w-14"
            onClick={openBoardChat}
            aria-label="Open assistant chat"
            title="Assistant"
          >
            <RobotIcon className="h-6 w-6 sm:h-7 sm:w-7" />
          </button>
        ) : null}
      </div>
      {/* Outside tab panels so the cat stays on Board and AI. */}
      <OnekoCat enabled />
    </div>
  );
}
