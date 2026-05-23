"use client";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none focus:border-sky-500 sm:text-lg";

type Props = {
  label: string;
  value: string;
  allDay: boolean;
  onChange: (value: string) => void;
  /** Start of allowed range (date or datetime-local string). */
  min?: string;
};

function todayDateKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function splitValue(
  value: string,
  allDay: boolean,
): { date: string; time: string } {
  const trimmed = value.trim();
  if (allDay) {
    const date = trimmed.slice(0, 10);
    return { date: DATE_RE.test(date) ? date : "", time: "09:00" };
  }
  const [datePart, timePart = "09:00"] = trimmed.split("T");
  const date = DATE_RE.test(datePart ?? "") ? datePart! : "";
  const time = TIME_RE.test(timePart ?? "") ? timePart! : "09:00";
  return { date, time };
}

function minDateFrom(min?: string): string | undefined {
  if (!min?.trim()) return undefined;
  const key = min.trim().slice(0, 10);
  return DATE_RE.test(key) ? key : undefined;
}

function minTimeFrom(min: string | undefined, date: string): string | undefined {
  if (!min?.trim() || !date) return undefined;
  const [minDate, minTime = "00:00"] = min.trim().split("T");
  if (minDate !== date || !TIME_RE.test(minTime)) return undefined;
  return minTime;
}

export function EventDateTimePicker({
  label,
  value,
  allDay,
  onChange,
  min,
}: Props) {
  const { date, time } = splitValue(value, allDay);
  const minDate = minDateFrom(min);
  const minTime = minTimeFrom(min, date);

  function setDate(nextDate: string) {
    if (allDay) {
      onChange(nextDate);
      return;
    }
    onChange(`${nextDate || todayDateKey()}T${time}`);
  }

  function setTime(nextTime: string) {
    onChange(`${date || minDate || todayDateKey()}T${nextTime}`);
  }

  return (
    <div className="block text-sm font-medium uppercase tracking-wide text-slate-400 sm:text-base">
      <span>{label}</span>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-stretch">
        <input
          type="date"
          className={`${INPUT} min-h-[2.75rem] sm:flex-1`}
          value={date}
          min={minDate}
          onChange={(e) => setDate(e.target.value)}
        />
        {!allDay ? (
          <input
            type="time"
            step={900}
            className={`${INPUT} min-h-[2.75rem] sm:w-[9.5rem] sm:shrink-0`}
            value={time}
            min={minTime}
            onChange={(e) => setTime(e.target.value)}
          />
        ) : null}
      </div>
    </div>
  );
}
