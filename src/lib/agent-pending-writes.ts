import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getDataDir } from "./data-dir";
import {
  formatPendingSummary,
  WRITE_TOOLS_NEEDING_APPROVAL,
  type PendingWriteItem,
} from "./agent-pending-writes-format";

export {
  formatPendingSummary,
  previewWriteLabel,
  WRITE_TOOLS_NEEDING_APPROVAL,
  type PendingWriteItem,
} from "./agent-pending-writes-format";

const PENDING_DIR = "agent-pending-writes";
const TTL_MS = 30 * 60 * 1000;

export type PendingWriteBatch = {
  id: string;
  createdAt: string;
  expiresAt: string;
  channel: "board" | "slack";
  /** Slack conversation key, when channel is slack. */
  conversationKey?: string;
  redirectUri: string;
  items: PendingWriteItem[];
  /** Paths read during the proposing turn (needed for rewrite_wiki_page). */
  wikiReads: Record<string, { path: string; sha: string }>;
  status: "pending" | "approved" | "rejected" | "expired";
};

export type PendingApprovalView = {
  id: string;
  summary: string;
  items: { tool: string; label: string }[];
  expiresAt: string;
};

function pendingDir(): string {
  return path.join(getDataDir(), PENDING_DIR);
}

function fileFor(id: string): string {
  return path.join(pendingDir(), `${id}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(pendingDir(), { recursive: true });
}

function isExpired(batch: PendingWriteBatch): boolean {
  return Date.now() > new Date(batch.expiresAt).getTime();
}

export async function readPendingBatch(id: string): Promise<PendingWriteBatch | null> {
  try {
    const raw = await fs.readFile(fileFor(id), "utf-8");
    return JSON.parse(raw) as PendingWriteBatch;
  } catch {
    return null;
  }
}

async function writePendingBatch(batch: PendingWriteBatch): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(batch.id), JSON.stringify(batch, null, 2), "utf-8");
}

export async function savePendingBatch(input: {
  channel: "board" | "slack";
  conversationKey?: string;
  redirectUri: string;
  items: PendingWriteItem[];
  wikiReads: Map<string, { path: string; sha: string }>;
}): Promise<PendingWriteBatch> {
  const now = Date.now();
  const batch: PendingWriteBatch = {
    id: randomUUID(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    channel: input.channel,
    conversationKey: input.conversationKey,
    redirectUri: input.redirectUri,
    items: input.items,
    wikiReads: Object.fromEntries(input.wikiReads),
    status: "pending",
  };
  await writePendingBatch(batch);
  return batch;
}

export async function markPendingBatch(
  id: string,
  status: "approved" | "rejected" | "expired",
): Promise<PendingWriteBatch | null> {
  const batch = await readPendingBatch(id);
  if (!batch) return null;
  batch.status = status;
  await writePendingBatch(batch);
  return batch;
}

/** Latest still-pending batch for a Slack conversation (if any). */
export async function findPendingForConversation(
  conversationKey: string,
): Promise<PendingWriteBatch | null> {
  try {
    await ensureDir();
    const names = await fs.readdir(pendingDir());
    let best: PendingWriteBatch | null = null;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const batch = await readPendingBatch(name.replace(/\.json$/, ""));
      if (!batch || batch.conversationKey !== conversationKey) continue;
      if (batch.status !== "pending") continue;
      if (isExpired(batch)) {
        batch.status = "expired";
        await writePendingBatch(batch);
        continue;
      }
      if (!best || batch.createdAt > best.createdAt) best = batch;
    }
    return best;
  } catch {
    return null;
  }
}

export function pendingBatchView(batch: PendingWriteBatch): PendingApprovalView {
  return {
    id: batch.id,
    summary: formatPendingSummary(batch.items),
    items: batch.items.map((i) => ({ tool: i.tool, label: i.label })),
    expiresAt: batch.expiresAt,
  };
}

export function assertPendingRunnable(batch: PendingWriteBatch): void {
  if (batch.status !== "pending") {
    throw new Error(`This review was already ${batch.status}.`);
  }
  if (isExpired(batch)) {
    batch.status = "expired";
    void writePendingBatch(batch);
    throw new Error("This review expired. Ask the assistant again.");
  }
}
