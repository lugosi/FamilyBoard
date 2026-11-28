import { createHash } from "node:crypto";

export const IMAGE_READING_TTL_MS = 24 * 60 * 60_000;
export const MAX_READING_CHARS = 4000;
export const MAX_READING_ENTRIES = 50;

export const IMAGE_REPLY_SCRUBBED = "(Reply not saved: it may have included text from a photo.)";

export type ImageReading = {
  scope: string;
  sha256: string;
  name: string;
  mimeType: string;
  /** What the vision model read from the image; image bytes are never stored. */
  text: string;
  corrected: boolean;
  createdAt: number;
  expiresAt: number;
};

/** `board` for the web chat, `slack:<conversationKey>` for a Slack DM or thread. */
export function imageReadingScope(channel: string | undefined, conversationKey?: string): string {
  return channel === "slack" && conversationKey ? `slack:${conversationKey}` : "board";
}

export function hashImageData(base64: string): string {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex");
}

export function pruneReadings(entries: ImageReading[], now: number): ImageReading[] {
  return entries.filter((e) => e.expiresAt > now);
}

export function upsertReading(
  entries: ImageReading[],
  entry: ImageReading,
  now: number,
): ImageReading[] {
  const rest = pruneReadings(entries, now).filter(
    (e) => !(e.scope === entry.scope && e.sha256 === entry.sha256),
  );
  return [...rest, entry].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_READING_ENTRIES);
}

export function findReading(
  entries: ImageReading[],
  scope: string,
  sha256: string,
  now: number,
): ImageReading | null {
  return entries.find((e) => e.scope === scope && e.sha256 === sha256 && e.expiresAt > now) ?? null;
}

/** Overwrite a reading's text (anyone in the scope may do this); the original expiry is kept. */
export function correctReading(
  entries: ImageReading[],
  scope: string,
  name: string | undefined,
  text: string,
  now: number,
): { entries: ImageReading[]; entry: ImageReading | null } {
  const live = pruneReadings(entries, now).filter((e) => e.scope === scope);
  const wanted = name?.trim().toLowerCase();
  const target =
    (wanted ? live.find((e) => e.name.toLowerCase() === wanted) : undefined) ?? live[0] ?? null;
  if (!target) return { entries: pruneReadings(entries, now), entry: null };
  const entry: ImageReading = {
    ...target,
    text: text.trim().slice(0, MAX_READING_CHARS),
    corrected: true,
  };
  return {
    entries: pruneReadings(entries, now).map((e) => (e === target ? entry : e)),
    entry,
  };
}

/** Prompt block that stands in for the picture on turns where the bytes aren't sent. */
export function readingsPrompt(readings: readonly ImageReading[]): string {
  return readings
    .map((r) => {
      const state = r.corrected ? "corrected by the family" : "machine-read, may contain mistakes";
      return `[Image reading "${r.name}" (${state}; cached 24h). Use it to fill records only; never quote it back.]\n${r.text}`;
    })
    .join("\n\n");
}

type ScrubbableTurn = {
  role: string;
  content: string;
  attachments?: { kind: string }[];
  quickActions?: unknown;
};

/** The model's reply to a photo may quote it, so don't persist that reply text. */
export function scrubImageTurnReplies<T extends ScrubbableTurn>(turns: T[]): T[] {
  return turns.map((t, i) => {
    const prev = turns[i - 1];
    if (t.role !== "model" || prev?.role !== "user") return t;
    if (!prev.attachments?.some((a) => a.kind === "image")) return t;
    const { quickActions: _dropped, ...rest } = t;
    void _dropped;
    return { ...rest, content: IMAGE_REPLY_SCRUBBED } as T;
  });
}
