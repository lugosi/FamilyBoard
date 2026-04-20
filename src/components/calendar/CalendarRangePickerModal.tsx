"use client";

type Props = {
  open: boolean;
  draftFrom: string;
  draftTo: string;
  onDraftFrom: (v: string) => void;
  onDraftTo: (v: string) => void;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
};

export function CalendarRangePickerModal({
  open,
  draftFrom,
  draftTo,
  onDraftFrom,
  onDraftTo,
  onClose,
  onApply,
  onReset,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="range-picker-title"
      >
        <h3 id="range-picker-title" className="text-xl font-semibold text-white sm:text-2xl">
          Visible date range
        </h3>
        <p className="mt-1 text-base text-slate-400 sm:text-lg">
          Choose the first and last day to show. Weeks are shown Monday–Sunday
          (Google-style). The calendar loads every event in this range.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
            From
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => onDraftFrom(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
            />
          </label>
          <label className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
            Through
            <input
              type="date"
              value={draftTo}
              onChange={(e) => onDraftTo(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg"
            />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full border border-slate-600 px-4 py-2.5 text-base text-slate-200 hover:border-slate-400 sm:text-lg"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-full bg-sky-600 px-4 py-2.5 text-base font-medium text-white hover:bg-sky-500 sm:text-lg"
            onClick={onApply}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-600 px-4 py-2.5 text-base text-slate-300 hover:bg-slate-800 sm:text-lg"
            onClick={onReset}
          >
            This week + 3 weeks
          </button>
        </div>
      </div>
    </div>
  );
}
