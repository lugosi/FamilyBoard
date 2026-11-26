"use client";

import type { BoardSettings, BoardThemeId } from "@/lib/board-settings";
import type { BoardSettingsSnapshot } from "@/components/useBoardSettings";

const FIELD_LABEL =
  "text-sm font-medium uppercase tracking-wide text-slate-300 sm:text-base";

export function GearIcon({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function BoardSettingsWidget({
  collapsed,
  onToggleCollapse,
  snapshot,
  error,
  saving,
  onChange,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  snapshot: BoardSettingsSnapshot | null;
  error: string | null;
  saving: boolean;
  onChange: (patch: Partial<BoardSettings>) => void;
}) {
  const settings = snapshot?.settings;
  const defaultLabel =
    snapshot?.geminiModels.find((m) => m.id === snapshot.defaultGeminiModel)
      ?.label ?? snapshot?.defaultGeminiModel;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-lg shadow-slate-950/40 sm:rounded-2xl sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {collapsed ? (
            <GearIcon className="h-8 w-8 shrink-0 text-slate-300 sm:h-9 sm:w-9" />
          ) : null}
          <h2 className="truncate text-xl font-medium text-white sm:text-2xl">
            Settings
          </h2>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800/70 hover:text-white"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand settings" : "Collapse settings"}
          title={collapsed ? "Expand settings" : "Collapse settings"}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {collapsed ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
          </svg>
        </button>
      </div>

      {collapsed ? null : !snapshot || !settings ? (
        <p className="mt-3 text-base text-slate-400 sm:text-lg">Loading settings…</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="space-y-1.5">
            <label className={FIELD_LABEL} htmlFor="board-gemini-model">
              Gemini model
            </label>
            <select
              id="board-gemini-model"
              className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-base text-slate-100 sm:text-lg"
              value={settings.geminiModel ?? ""}
              onChange={(e) =>
                onChange({
                  geminiModel: (e.target.value || null) as BoardSettings["geminiModel"],
                })
              }
            >
              <option value="">
                Auto
                {snapshot.envGeminiModel
                  ? ` (${snapshot.envGeminiModel} from server env)`
                  : ` (${defaultLabel ?? snapshot.defaultGeminiModel})`}
              </option>
              {snapshot.geminiModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.note}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 sm:text-sm">
              Using{" "}
              <code className="rounded bg-slate-800 px-1 py-0.5 text-slate-200">
                {snapshot.effectiveGeminiModel}
              </code>{" "}
              for WikiLLM, Slack, and briefs.
              {snapshot.geminiConfigured ? "" : " Set GEMINI_API_KEY to enable it."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={FIELD_LABEL} id="board-night-mode-label">
                Night mode
              </p>
              <p className="text-xs text-slate-400 sm:text-sm">
                Greyscale the board from sunset (or 10pm) until sunrise (or 7am).
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.nightMode}
              aria-labelledby="board-night-mode-label"
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                settings.nightMode ? "bg-sky-500" : "bg-slate-700"
              }`}
              onClick={() => onChange({ nightMode: !settings.nightMode })}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                  settings.nightMode ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="space-y-1.5">
            <p className={FIELD_LABEL}>Color theme</p>
            <div
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
              role="radiogroup"
              aria-label="Color theme"
            >
              {snapshot.themes.map((t) => {
                const active = settings.theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${
                      active
                        ? "border-sky-500 text-white"
                        : "border-slate-700 text-slate-300 hover:border-slate-500"
                    }`}
                    onClick={() => onChange({ theme: t.id as BoardThemeId })}
                  >
                    <span
                      aria-hidden
                      className="flex h-8 w-full overflow-hidden rounded-md border border-white/10"
                    >
                      <span
                        className="h-full flex-[3]"
                        style={{ backgroundColor: t.swatch.surface }}
                      />
                      <span
                        className="h-full flex-1"
                        style={{ backgroundColor: t.swatch.accent }}
                      />
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              {error}
            </p>
          ) : saving ? (
            <p className="text-xs text-slate-500 sm:text-sm">Saving…</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
