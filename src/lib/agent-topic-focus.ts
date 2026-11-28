import type { GeminiMessage } from "./gemini";

/**
 * The model sees the whole Slack thread, and it used to be told that skipping
 * a write was a bug. A new subject (GTA) then kept updating notes from an
 * earlier one (K1). These rules, plus `offTopicWikiWriteError`, keep a turn
 * on the latest message.
 */
export const TOPIC_FOCUS_RULES = [
  "The latest user message is the only task. Earlier messages are background: use them only when the latest message clearly continues that subject (a short follow-up, or “that” / “it” / “save that”). When the latest message is a new subject, answer only that subject. Do not recap, continue, or write about the earlier one.",
  "Wiki writes — family wiki and `.context/` — must record the latest message. The server rejects a write whose content is about a different topic than that message.",
] as const;

const WIKI_WRITE_TOOLS = new Set(["create_wiki_page", "edit_wiki_section", "rewrite_wiki_page"]);

const STOP = new Set([
  "about","active","after","again","also","and","another","are","around","back","because","been","before","being","best","could","doing","does","down","each","facts","from","have","having","here","into","just","like","more","need","notes","only","onto","over","page","place","please","really","right","save","saved","section","should","some","something","still","than","that","them","then","there","these","they","this","those","very","want","what","when","where","which","wiki","with","would","your",
]);

const FOLLOW_UP =
  /^(yes|yeah|yep|yup|ok|okay|sure|please|do it|go ahead|sounds good)\b/i;

const FOLLOW_UP_REF =
  /\b(save|remember|note|log|add|put|update|write)\b[\s\S]{0,40}\b(that|this|it|them|those|same)\b/i;

export function offTopicWikiWriteError(
  messages: Pick<GeminiMessage, "role" | "content">[],
  tool: string,
  args: Record<string, unknown>,
): string | undefined {
  if (!WIKI_WRITE_TOOLS.has(tool)) return undefined;
  const latest = latestUserText(messages);
  if (!latest.trim() || isFollowUp(latest)) return undefined;
  const written = writtenText(args);
  if (!written.trim()) return undefined;
  if (sharesTopic(latest, written)) return undefined;
  return "Blocked: this wiki write is about a different topic than the latest user message. Answer that message only. Do not update notes from an earlier topic in the thread.";
}

function latestUserText(messages: Pick<GeminiMessage, "role" | "content">[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user" && message.content.trim()) return message.content;
  }
  return "";
}

/** Slack threads prefix each turn with "Name: ". That name is not the topic. */
function messageBody(content: string): string {
  return content.replace(
    /^(?:[\p{L}][\p{L}.'-]{0,40})(?:\s+[\p{L}][\p{L}.'-]{0,40}){0,2}:\s+/u,
    "",
  );
}

function isFollowUp(latest: string): boolean {
  const body = messageBody(latest).trim();
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;
  return FOLLOW_UP.test(body) || FOLLOW_UP_REF.test(body);
}

function writtenText(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of ["text", "body", "title", "summary", "section"]) {
    const value = args[key];
    if (typeof value === "string") parts.push(value);
  }
  if (Array.isArray(args.tags)) {
    parts.push(args.tags.filter((tag): tag is string => typeof tag === "string").join(" "));
  }
  return parts.join("\n");
}

function tokens(text: string): string[] {
  const found = messageBody(text).toLowerCase().match(/[a-z0-9][a-z0-9.+#-]{1,}/g) ?? [];
  const out: string[] = [];
  for (const token of found) {
    if (STOP.has(token)) continue;
    if (/^(19|20)\d{2}$/.test(token)) continue;
    if (/\d/.test(token) ? token.length < 2 : token.length < 4) continue;
    out.push(token);
  }
  return out;
}

function sameToken(contentToken: string, userToken: string): boolean {
  if (contentToken === userToken) return true;
  const contentNum = contentToken.replace(/[^0-9.]/g, "");
  const userNum = userToken.replace(/[^0-9.]/g, "");
  if (contentNum.length >= 3 && contentNum === userNum) return true;
  if (contentToken.length >= 4 && userToken.length >= 4) {
    return contentToken.startsWith(userToken) || userToken.startsWith(contentToken);
  }
  return false;
}

function sharesTopic(latest: string, written: string): boolean {
  const user = tokens(latest);
  const content = tokens(written);
  if (!content.length) return false;
  let shared = 0;
  let alien = 0;
  for (const token of content) {
    if (user.some((candidate) => sameToken(token, candidate))) shared += 1;
    else alien += 1;
  }
  return shared >= 1 && shared >= alien;
}
