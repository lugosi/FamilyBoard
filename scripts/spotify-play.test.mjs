import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickBestCandidate,
  playSpotifyContext,
  SpotifyPlayError,
} from "../src/lib/spotify-play.ts";

function mockSpotify(routes) {
  const calls = [];
  const fetchSpotify = async (endpoint, init) => {
    calls.push({ endpoint, init });
    for (const [prefix, reply] of routes) {
      if (endpoint.startsWith(prefix)) return typeof reply === "function" ? reply(init) : reply;
    }
    return { status: 404, data: null };
  };
  return { fetchSpotify, calls };
}

const speaker = { id: "dev1", name: "Kitchen", is_active: true };

test("pickBestCandidate prefers exact name + artist and skips null items", () => {
  const best = pickBestCandidate(
    [
      null,
      { name: "Abbey Road (Super Deluxe)", uri: "spotify:album:a", artists: [{ name: "The Beatles" }] },
      { name: "Abbey Road", uri: "spotify:album:b", artists: [{ name: "Tribute Band" }] },
      { name: "Abbey Road", uri: "spotify:album:c", artists: [{ name: "The Beatles" }] },
    ],
    "abbey road",
    "The Beatles",
  );
  assert.equal(best?.uri, "spotify:album:c");
  assert.equal(pickBestCandidate([null, undefined], "x"), null);
});

test("play album searches albums and starts context_uri on the active device", async () => {
  const { fetchSpotify, calls } = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [{ id: "idle", name: "Phone" }, speaker] } }],
    [
      "/search",
      {
        status: 200,
        data: {
          albums: {
            items: [{ name: "Abbey Road", uri: "spotify:album:xyz", artists: [{ name: "The Beatles" }] }],
          },
        },
      },
    ],
    ["/me/player/play", { status: 204, data: null }],
  ]);
  const out = await playSpotifyContext(fetchSpotify, { kind: "album", query: "Abbey Road" });
  assert.equal(out.uri, "spotify:album:xyz");
  assert.equal(out.device, "Kitchen");
  assert.equal(out.owner, "The Beatles");
  const search = calls.find((c) => c.endpoint.startsWith("/search"));
  assert.match(search.endpoint, /type=album/);
  assert.ok(!calls.some((c) => c.endpoint.includes("recommendations")));
  const play = calls.find((c) => c.endpoint.startsWith("/me/player/play"));
  assert.match(play.endpoint, /device_id=dev1/);
  assert.equal(play.init.method, "PUT");
  assert.deepEqual(JSON.parse(play.init.body), { context_uri: "spotify:album:xyz" });
});

test("play mood searches playlists, tolerating null playlist items", async () => {
  const { fetchSpotify, calls } = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [speaker] } }],
    [
      "/search",
      {
        status: 200,
        data: {
          playlists: {
            items: [null, { name: "Chill Cooking", uri: "spotify:playlist:p1", owner: { display_name: "Someone" } }],
          },
        },
      },
    ],
    ["/me/player/play", { status: 204, data: null }],
  ]);
  const out = await playSpotifyContext(fetchSpotify, { kind: "playlist", query: "chill cooking" });
  assert.equal(out.name, "Chill Cooking");
  assert.match(calls.find((c) => c.endpoint.startsWith("/search")).endpoint, /type=playlist/);
  assert.deepEqual(
    JSON.parse(calls.find((c) => c.endpoint.startsWith("/me/player/play")).init.body),
    { context_uri: "spotify:playlist:p1" },
  );
});

test("no devices online gives a clear error and never searches or plays", async () => {
  const { fetchSpotify, calls } = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [] } }],
  ]);
  await assert.rejects(
    playSpotifyContext(fetchSpotify, { kind: "album", query: "Abbey Road" }),
    (e) => e instanceof SpotifyPlayError && e.code === "no_device" && /No Spotify speaker is online/.test(e.message),
  );
  assert.equal(calls.length, 1);
});

test("devices online but none active lists them in the error", async () => {
  const { fetchSpotify } = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [{ id: "a", name: "Kitchen" }, { id: "b", name: "Den" }] } }],
  ]);
  await assert.rejects(
    playSpotifyContext(fetchSpotify, { kind: "playlist", query: "chill" }),
    (e) => e.code === "no_active_device" && /Kitchen, Den/.test(e.message),
  );
});

test("no search results and play failures surface distinct errors", async () => {
  const noResults = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [speaker] } }],
    ["/search", { status: 200, data: { albums: { items: [] } } }],
  ]);
  await assert.rejects(
    playSpotifyContext(noResults.fetchSpotify, { kind: "album", query: "zzzz" }),
    (e) => e.code === "no_results",
  );
  const premium = mockSpotify([
    ["/me/player/devices", { status: 200, data: { devices: [speaker] } }],
    ["/search", { status: 200, data: { albums: { items: [{ name: "A", uri: "spotify:album:a" }] } } }],
    ["/me/player/play", { status: 403, data: { error: { message: "Premium required" } } }],
  ]);
  await assert.rejects(
    playSpotifyContext(premium.fetchSpotify, { kind: "album", query: "A" }),
    (e) => e.code === "premium_required",
  );
  await assert.rejects(
    playSpotifyContext(premium.fetchSpotify, { kind: "album", query: "  " }),
    (e) => e.code === "no_results",
  );
});
