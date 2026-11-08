import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createGateSession,
  hashGateToken,
  isValidGateSession,
  secretFingerprint,
} from "../src/lib/gate-sessions";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-gate-"));
process.env.DATA_DIR = dir;

const config = { code: "family-pass", secret: "server-secret-one" };
const { token } = await createGateSession(config);
assert.equal(await isValidGateSession(token, config), true);
assert.equal(await isValidGateSession("not-a-real-token-value-xx", config), false);

const storeRaw = await fs.readFile(path.join(dir, "gate-sessions.json"), "utf-8");
assert.equal(storeRaw.includes(token), false, "raw cookie must not be stored");
const store = JSON.parse(storeRaw) as {
  secretFingerprint: string;
  sessions: { hash: string }[];
};
assert.equal(store.secretFingerprint, secretFingerprint(config.secret));
assert.equal(store.sessions[0]?.hash, hashGateToken(token));

const rotated = { code: "family-pass", secret: "server-secret-two" };
assert.equal(await isValidGateSession(token, rotated), false);
const { token: token2 } = await createGateSession(rotated);
assert.equal(await isValidGateSession(token2, rotated), true);
assert.equal(await isValidGateSession(token, rotated), false);

console.log("gate-sessions ok");
