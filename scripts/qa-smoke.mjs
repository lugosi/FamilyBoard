#!/usr/bin/env node
/**
 * FamilyBoard API smoke checks.
 * Expects a running server at BASE_URL (default http://127.0.0.1:3000).
 * Leave BOARD_ACCESS_* unset so the gate does not return 401 Locked.
 */

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);

/** @typedef {{ ok: boolean, name: string, status: number | string, detail: string }} Row */

/** @type {Row[]} */
const rows = [];

function calendarRangeQuery() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 7);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

/**
 * @param {string} path
 * @returns {Promise<{ status: number, body: unknown, locked: boolean }>}
 */
async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json" },
    redirect: "manual",
  });
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 120);
  }
  const locked =
    res.status === 401 &&
    body &&
    typeof body === "object" &&
    body.error === "Locked";
  return { status: res.status, body, locked };
}

/**
 * @param {string} name
 * @param {number} status
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, status, ok, detail) {
  rows.push({ ok, name, status, detail });
}

/**
 * @param {unknown} statusBody
 */
function expectSpotify(statusBody) {
  const linked = Boolean(statusBody?.spotifyLinked);
  const configured = Boolean(statusBody?.spotifyConfigured);
  if (linked) return new Set([200]);
  if (configured) return new Set([401]);
  return new Set([501]);
}

/**
 * @param {string} name
 * @param {string} path
 * @param {Set<number>} allowed
 * @param {{ allowLocked?: boolean }} [opts]
 */
async function check(name, path, allowed, opts = {}) {
  try {
    const { status, body, locked } = await getJson(path);
    if (locked && !opts.allowLocked) {
      record(name, status, false, "gate locked (unset BOARD_ACCESS_* or unlock)");
      return;
    }
    const ok = allowed.has(status);
    const err =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : "";
    record(
      name,
      status,
      ok,
      ok
        ? err || "ok"
        : `expected ${[...allowed].join("|")}, got ${status}${err ? ` (${err})` : ""}`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    record(name, "ERR", false, message);
  }
}

async function main() {
  let statusBody;
  try {
    const { status, body, locked } = await getJson("/api/auth/status");
    if (locked) {
      record(
        "GET /api/auth/status",
        status,
        false,
        "gate locked (unset BOARD_ACCESS_* or unlock)",
      );
      printAndExit();
      return;
    }
    if (status !== 200 || !body || typeof body !== "object") {
      record(
        "GET /api/auth/status",
        status,
        false,
        `expected 200 JSON, got ${status}`,
      );
      printAndExit();
      return;
    }
    statusBody = body;
    record("GET /api/auth/status", status, true, "ok");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    record("GET /api/auth/status", "ERR", false, message);
    printAndExit();
    return;
  }

  const weatherOk = statusBody.weatherConfigured
    ? new Set([200])
    : new Set([501]);
  await check("GET /api/weather", "/api/weather", weatherOk);

  // Linked → 200; configured-but-unlinked → 401; else non-500 (often 401 "not linked" or 500)
  /** @type {Set<number>} */
  let calendarAllowed;
  if (statusBody.googleLinked) {
    calendarAllowed = new Set([200]);
  } else if (statusBody.googleConfigured) {
    calendarAllowed = new Set([401]);
  } else {
    calendarAllowed = new Set([401, 500]);
  }
  await check(
    "GET /api/calendar/events",
    `/api/calendar/events?${calendarRangeQuery()}`,
    calendarAllowed,
  );

  const catlinkOk = statusBody.catlinkLinked
    ? new Set([200])
    : new Set([501]);
  await check("GET /api/catlink", "/api/catlink", catlinkOk);

  /** @type {Set<number>} */
  let nestAllowed;
  if (statusBody.googleLinked && statusBody.nestConfigured) {
    nestAllowed = new Set([200, 401, 403]);
  } else {
    nestAllowed = new Set([501]);
  }
  await check("GET /api/nest/indoor", "/api/nest/indoor", nestAllowed);

  const hueOk = statusBody.hueReady ? new Set([200]) : new Set([501]);
  await check("GET /api/hue/lights", "/api/hue/lights", hueOk);
  await check("GET /api/hue/areas", "/api/hue/areas", hueOk);

  const spotifyOk = expectSpotify(statusBody);
  for (const path of [
    "/api/spotify/now-playing",
    "/api/spotify/devices",
    "/api/spotify/recent",
    "/api/spotify/featured",
  ]) {
    await check(`GET ${path}`, path, spotifyOk);
  }

  printAndExit();
}

function printAndExit() {
  const width = Math.max(...rows.map((r) => r.name.length), 10);
  console.log(`FamilyBoard API smoke @ ${BASE_URL}`);
  console.log("-".repeat(width + 28));
  for (const r of rows) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(
      `${mark.padEnd(4)}  ${r.name.padEnd(width)}  ${String(r.status).padStart(4)}  ${r.detail}`,
    );
  }
  const failed = rows.filter((r) => !r.ok).length;
  console.log("-".repeat(width + 28));
  console.log(
    failed === 0
      ? `All ${rows.length} checks passed.`
      : `${failed}/${rows.length} checks failed.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
