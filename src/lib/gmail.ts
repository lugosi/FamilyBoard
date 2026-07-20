import { google } from "googleapis";
import { getOAuth2WithRefresh } from "./google";
import { generateGeminiText } from "./gemini";
import { addTodos, type FamilyTodo } from "./todos";

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

export async function scanInboxToTodos(
  redirectUri: string,
): Promise<{ added: FamilyTodo[]; scanned: number; skipped: number }> {
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
    return { added: [], scanned: 0, skipped: 0 };
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

  const raw = await generateGeminiText({
    system: `You extract actionable family todos from emails forwarded to a household inbox.
Return ONLY valid JSON: {"todos":[{"title":"...","notes":"...","dueHint":"...","sourceMessageId":"..."}]}
Rules:
- title is short and actionable (e.g. "Schedule dentist appointment")
- sourceMessageId must match an email messageId from the input
- skip newsletters, receipts with no action, and marketing
- if nothing actionable, return {"todos":[]}`,
    messages: [
      {
        role: "user",
        content: `Extract todos from these emails:\n\n${emailBlocks.join("\n")}`,
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
  } = {};
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match?.[0] ?? raw) as typeof parsed;
  } catch {
    throw new Error("Gemini todo extract was not valid JSON");
  }

  const candidates = (parsed.todos ?? [])
    .filter((t) => t.title?.trim() && t.sourceMessageId)
    .map((t) => ({
      title: t.title!.trim(),
      notes: t.notes?.trim(),
      dueHint: t.dueHint?.trim(),
      sourceMessageId: t.sourceMessageId!.trim(),
    }));

  const added = await addTodos(candidates);

  for (const id of ids) {
    await gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: { addLabelIds: [processedLabelId] },
    });
  }

  return {
    added,
    scanned: ids.length,
    skipped: Math.max(0, ids.length - new Set(candidates.map((c) => c.sourceMessageId)).size),
  };
}
