/** Normalize "the Living Room lights" → "living" for fuzzy matching. */
export function squashHueAreaName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(the|room|lights?|area|zone)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
