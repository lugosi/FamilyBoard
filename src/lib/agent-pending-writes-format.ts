/** Pure helpers for staged calendar/wiki writes (no I/O). */

export const WRITE_TOOLS_NEEDING_APPROVAL = new Set([
  "create_event",
  "update_event",
  "delete_event",
  "create_wiki_page",
  "edit_wiki_section",
  "rewrite_wiki_page",
  "move_wiki_page",
  "delete_wiki_page",
  "save_skill",
]);

export type PendingWriteItem = {
  tool: string;
  args: Record<string, unknown>;
  /** Human one-liner for the review card (server-built, not model text). */
  label: string;
};

export function formatPendingSummary(items: PendingWriteItem[]): string {
  if (!items.length) return "No changes.";
  const cal = items.filter(
    (i) =>
      i.tool === "create_event" || i.tool === "update_event" || i.tool === "delete_event",
  );
  const wiki = items.filter((i) => i.tool.includes("wiki") || i.tool === "save_skill");
  const lines: string[] = [];
  if (cal.length) {
    lines.push("Calendar");
    for (const i of cal) lines.push(`• ${i.label}`);
  }
  if (wiki.length) {
    if (lines.length) lines.push("");
    lines.push("Wiki");
    for (const i of wiki) lines.push(`• ${i.label}`);
  }
  const other = items.filter((i) => !cal.includes(i) && !wiki.includes(i));
  for (const i of other) lines.push(`• ${i.label}`);
  return lines.join("\n");
}

/** Short preview labels for common write tools (used when staging, before execute). */
export function previewWriteLabel(
  tool: string,
  args: Record<string, unknown>,
  timeZone: string,
): string {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
  switch (tool) {
    case "create_event": {
      const title = s(args.summary) || "event";
      const when = s(args.start) || s(args.startDate) || "";
      return when ? `Add “${title}” · ${formatPreviewWhen(when, timeZone)}` : `Add “${title}”`;
    }
    case "update_event": {
      const title = s(args.summary) || s(args.eventId) || "event";
      return `Update “${title}”`;
    }
    case "delete_event": {
      const title = s(args.summary) || s(args.eventId) || "event";
      return `Delete “${title}”`;
    }
    case "create_wiki_page":
      return `Create wiki page “${s(args.title) || "untitled"}” (${s(args.category) || "notes"})`;
    case "edit_wiki_section": {
      const page = s(args.path) || "page";
      const section = s(args.section);
      const mode = s(args.mode) === "replace" ? "Replace" : "Append to";
      return section ? `${mode} “${section}” on ${page}` : `${mode} ${page}`;
    }
    case "rewrite_wiki_page":
      return `Rewrite wiki page ${s(args.path) || "(path)"}`;
    case "move_wiki_page":
      return `Move ${s(args.path) || "?"} → ${s(args.newPath) || "?"}`;
    case "delete_wiki_page":
      return `Delete wiki page ${s(args.path) || "?"}`;
    case "save_skill":
      return `Save skill “${s(args.name) || "untitled"}”`;
    default:
      return tool;
  }
}

function formatPreviewWhen(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }
  const hasOffset = /(Z|[+-]\d{2}:\d{2})$/.test(value);
  const date = new Date(hasOffset ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: hasOffset ? timeZone : "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
