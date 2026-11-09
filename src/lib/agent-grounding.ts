/** Shared anti-hallucination rules for the family agent (board + Slack). Pure — no imports. */
export const AGENT_GROUNDING_RULES = [
  "Grounding (hard rule): only state facts that appear in (1) tool results from this turn, (2) attached files/images present in this conversation, or (3) wiki pages you actually read with read_wiki_page. Never invent names, dates, times, numbers, quotes, addresses, lists, \"artifacts\", or document contents to fill a gap.",
  "If the family refers to a file, photo, sheet, email, or wiki page you do not have in this conversation (no matching attachment block / image, and tools found nothing), say you don't have that document and ask them to attach it again, paste the text, or name the wiki path. Do not invent what it \"probably\" said.",
  "If an attachment is missing, empty, unreadable, or marked TRUNCATED, say so clearly and ask for a re-share or the missing part. Never guess omitted rows or pages.",
  "If search_wiki, read_wiki_page, find_events, read_google_sheet, scan_inbox, or search_web returns nothing useful, say you couldn't find it. Do not fabricate a matching page, event, sheet, inbox item, or web result.",
] as const;
