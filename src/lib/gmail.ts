import { google } from "googleapis";
import { generateGeminiText } from "./gemini";
import { addTodos, type FamilyTodo } from "./todos";
import { createCalendarEvent, todayDateKey } from "./calendar";
import { getDefaultTimeZone, getOAuth2WithRefresh } from "./google";

const PROCESSED_LABEL_NAME = "FamilyBoard/Processed";

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  processed: boolean;
};

function headerValue(
  headers: { name?: string | null; value?: string | null }[] | undefined,
  name: string,
): string {
  const hit = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return hit?.value?.trim() || "";
}

function decodeBodyData(data?: string | null): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

type MessagePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MessagePart[] | null;
};

function extractText(payload?: MessagePart | null): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBodyData(payload.body.data);
  }
  if (payload.parts?.length) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeBodyData(plain.body.data);
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) {
      return decodeBodyData(html.body.data)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return payload.parts.map((p) => extractText(p)).join("\n");
  }
  if (payload.body?.data) return decodeBodyData(payload.body.data);
  return "";
}

async function getGmail(redirectUri: string) {
  const auth = await getOAuth2WithRefresh(redirectUri);
  return google.gmail({ version: "v1", auth });
}

async function ensureProcessedLabelId(
  gmail: ReturnType<typeof google.gmail>,
): Promise<string> {
  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find((l) => l.name === PROCESSED_LABEL_NAME);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: PROCESSED_LABEL_NAME,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) throw new Error("Failed to create Gmail processed label");
  return created.data.id;
}

export async function fetchGmailSnapshot(
  redirectUri: string,
  opts?: { max?: number },
): Promise<{ messages: GmailMessageSummary[] }> {
  const gmail = await getGmail(redirectUri);
  let processedLabelId: string | null = null;
  try {
    processedLabelId = await ensureProcessedLabelId(gmail);
  } catch {
    processedLabelId = null;
  }

  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults: opts?.max ?? 25,
    q: "in:inbox",
  });
  const ids = listed.data.messages ?? [];
  const messages: GmailMessageSummary[] = [];

  for (const item of ids) {
    if (!item.id) continue;
    const full = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });
    const headers = full.data.payload?.headers;
    const labelIds = full.data.labelIds ?? [];
    messages.push({
      id: item.id,
      threadId: full.data.threadId || item.threadId || "",
      subject: headerValue(headers, "Subject") || "(no subject)",
      from: headerValue(headers, "From"),
      date: headerValue(headers, "Date"),
      snippet: full.data.snippet || "",
      processed: processedLabelId
        ? labelIds.includes(processedLabelId)
        : false,
    });
  }

  return { messages };
}

export type InboxCalendarResult = {
  summary: string;
  sourceMessageId: string;
  start: string;
  ok: boolean;
  error?: string;
  eventId?: string;
};

export type InboxScanResult = {
  added: FamilyTodo[];
  events: InboxCalendarResult[];
  scanned: number;
  skipped: number;
};

type ExtractedEvent = {
  summary?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
  location?: string;
  notes?: string;
  sourceMessageId?: string;
};

export async function scanInboxToTodos(
  redirectUri: string,
): Promise<InboxScanResult> {
  const gmail = await getGmail(redirectUri);
  const processedLabelId = await ensureProcessedLabelId(gmail);
  const listed = await gmail.users.messages.list({
    userId: "me",
    maxResults: 15,
    q: "in:inbox",
  });
  const candidatesIds = (listed.data.messages ?? [])
    .map((m) => m.id)
    .filter(Boolean) as string[];

  const ids: string[] = [];
  for (const id of candidatesIds) {
    const meta = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "minimal",
    });
    if (!(meta.data.labelIds ?? []).includes(processedLabelId)) {
      ids.push(id);
    }
  }
  if (ids.length === 0) {
    return { added: [], events: [], scanned: 0, skipped: 0 };
  }

  const emailBlocks: string[] = [];
  for (const id of ids) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });
    const headers = full.data.payload?.headers;
    const subject = headerValue(headers, "Subject");
    const from = headerValue(headers, "From");
    const date = headerValue(headers, "Date");
    const body = extractText(full.data.payload).slice(0, 6000);
    emailBlocks.push(
      `---\nmessageId: ${id}\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\n\n${body}\n`,
    );
  }

  const tz = getDefaultTimeZone();
  const today = todayDateKey(tz);
  const raw = await generateGeminiText({
    system: `You triage emails forwarded to a family household inbox into todos and calendar events.
Today is ${today}; the family's timezone is ${tz}.
Return ONLY valid JSON:
{"todos":[{"title":"...","notes":"...","dueHint":"...","sourceMessageId":"..."}],
 "events":[{"summary":"...","start":"YYYY-MM-DDTHH:MM","end":"YYYY-MM-DDTHH:MM","allDay":false,"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","location":"...","notes":"...","sourceMessageId":"..."}]}
Rules:
- events: only for a concrete appointment, reservation, class, game, flight, or school date with a known day. Use local wall-clock times in ${tz} with no offset.
- timed events need start and end; if no end is given assume 1 hour. Day-only events use allDay true with startDate (endDate exclusive, optional).
- skip events in the past and anything with an ambiguous date.
- todos: short actionable tasks (e.g. "Pay field trip fee"). Do not duplicate an event as a todo unless there is a separate task (e.g. "RSVP").
- sourceMessageId must match an email messageId from the input.
- skip newsletters, receipts with no action, and marketing.
- if nothing applies, return {"todos":[],"events":[]}`,
    messages: [
      {
        role: "user",
        content: `Triage these emails:\n\n${emailBlocks.join("\n")}`,
      },
    ],
  });

  let parsed: {
    todos?: {
      title?: string;
      notes?: string;
      dueHint?: string;
      sourceMessageId?: string;
    }[];
    events?: ExtractedEvent[];
  } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? raw) as typeof parsed;
  } catch {
    throw new Error("Gemini inbox triage was not valid JSON");
  }

  const idSet = new Set(ids);
  const candidates = (parsed.todos ?? [])
    .filter((t) => t.title?.trim() && t.sourceMessageId && idSet.has(t.sourceMessageId.trim()))
    .map((t) => ({
      title: t.title!.trim(),
      notes: t.notes?.trim(),
      dueHint: t.dueHint?.trim(),
      sourceMessageId: t.sourceMessageId!.trim(),
    }));

  const added = await addTodos(candidates);

  const events: InboxCalendarResult[] = [];
  for (const ev of parsed.events ?? []) {
    const summary = ev.summary?.trim();
    const sourceMessageId = ev.sourceMessageId?.trim();
    if (!summary || !sourceMessageId || !idSet.has(sourceMessageId)) continue;
    const start = (ev.allDay ? ev.startDate : ev.start) ?? "";
    try {
      const created = await createCalendarEvent(redirectUri, {
        summary,
        start: ev.start,
        end: ev.end,
        allDay: ev.allDay,
        startDate: ev.startDate,
        endDate: ev.endDate,
        location: ev.location,
        description: ev.notes,
        sourceMessageId,
      });
      events.push({ summary, sourceMessageId, start, ok: true, eventId: created.id });
    } catch (e) {
      events.push({
        summary,
        sourceMessageId,
        start,
        ok: false,
        error: e instanceof Error ? e.message : "calendar_error",
      });
    }
  }

  for (const id of ids) {
    await gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: { addLabelIds: [processedLabelId] },
    });
  }

  const usedIds = new Set([
    ...candidates.map((c) => c.sourceMessageId),
    ...events.filter((e) => e.ok).map((e) => e.sourceMessageId),
  ]);
  return {
    added,
    events,
    scanned: ids.length,
    skipped: Math.max(0, ids.length - usedIds.size),
  };
}
