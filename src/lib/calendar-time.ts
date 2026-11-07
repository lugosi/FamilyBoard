// Pure calendar time helpers (no I/O) — unit-tested with plain Node.

/** Local wall-clock time without offset, e.g. 2026-11-10T15:00 or 2026-11-10T15:00:00. */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Coerce tool input to a Pacific wall-clock string (no offset).
 * Models often append "Z" or an offset by mistake; we strip those and keep the
 * clock face the family meant (9:00 stays 9:00 in America/Los_Angeles).
 */
export function toFamilyLocalDateTime(value: string, field = "time"): string {
  const v = value.trim();
  if (LOCAL_DATE_TIME.test(v)) return v.length === 16 ? `${v}:00` : v;
  if (ISO_WITH_OFFSET.test(v)) {
    const stripped = v.replace(/\.\d+/, "").replace(/(Z|[+-]\d{2}:\d{2})$/, "");
    if (LOCAL_DATE_TIME.test(stripped)) {
      return stripped.length === 16 ? `${stripped}:00` : stripped;
    }
  }
  throw new Error(
    `${field} must be a local date-time like 2026-11-10T15:00 (Pacific, no Z/offset)`,
  );
}

/** Default end = start + 1 hour when the model omits the end. */
export function defaultEndFromStart(start: string): string {
  const local = toFamilyLocalDateTime(start, "start");
  const m = local.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error("start must be a local date-time like 2026-11-10T15:00");
  let hh = Number(m[2]);
  const mm = Number(m[3]);
  let day = m[1];
  hh += 1;
  if (hh >= 24) {
    hh -= 24;
    day = addDaysToDateKey(day, 1);
  }
  return `${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

export function isDateKey(value: string): boolean {
  return DATE_KEY.test(value);
}
