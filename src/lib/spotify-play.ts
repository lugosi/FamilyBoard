export type SpotifyFetch = (
  endpoint: string,
  init?: RequestInit,
) => Promise<{ status: number; data: unknown }>;

export type SpotifyContentKind = "album" | "playlist";

export type SpotifyPlayResult = {
  kind: SpotifyContentKind;
  name: string;
  owner: string | null;
  uri: string;
  device: string;
};

type Device = {
  id?: string;
  name?: string;
  is_active?: boolean;
  is_restricted?: boolean;
};

type Candidate = {
  name?: string;
  uri?: string;
  artists?: Array<{ name?: string }>;
  owner?: { display_name?: string };
};

export type SpotifyPlayErrorCode =
  | "no_device"
  | "no_active_device"
  | "no_results"
  | "premium_required"
  | "spotify_error";

export class SpotifyPlayError extends Error {
  readonly code: SpotifyPlayErrorCode;

  constructor(message: string, code: SpotifyPlayErrorCode) {
    super(message);
    this.name = "SpotifyPlayError";
    this.code = code;
  }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function errorDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const err = (data as { error?: { message?: string } | string }).error;
  const msg = typeof err === "string" ? err : err?.message;
  return msg ? `: ${msg.slice(0, 120)}` : "";
}

export function pickBestCandidate(
  items: Array<Candidate | null | undefined>,
  query: string,
  artist?: string,
): Candidate | null {
  const valid = items.filter(
    (i): i is Candidate => Boolean(i && typeof i === "object" && i.uri && i.name),
  );
  if (!valid.length) return null;
  const q = norm(query);
  const a = artist ? norm(artist) : "";
  let best = valid[0];
  let bestScore = -1;
  valid.forEach((item, idx) => {
    const name = norm(item.name ?? "");
    let score = 0;
    if (name === q) score += 4;
    else if (q && name.includes(q)) score += 2;
    else if (q && q.includes(name) && name) score += 1;
    if (a) {
      const names = (item.artists ?? []).map((x) => norm(x.name ?? ""));
      if (names.some((n) => n === a)) score += 3;
      else if (names.some((n) => n.includes(a) || a.includes(n))) score += 1;
    }
    // Earlier results are Spotify's own relevance order; break ties by it.
    score -= idx * 0.01;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  });
  return best;
}

export async function findActiveDevice(fetchSpotify: SpotifyFetch): Promise<Device> {
  const out = await fetchSpotify("/me/player/devices");
  if (out.status >= 400) {
    throw new SpotifyPlayError(
      `Spotify devices lookup failed (${out.status})${errorDetail(out.data)}`,
      "spotify_error",
    );
  }
  const devices = ((out.data as { devices?: Device[] } | null)?.devices ?? []).filter(
    (d) => d?.id && !d.is_restricted,
  );
  if (!devices.length) {
    throw new SpotifyPlayError(
      "No Spotify speaker is online. Open Spotify on the speaker (or wake it by casting to it once), then ask again.",
      "no_device",
    );
  }
  const active = devices.find((d) => d.is_active);
  if (!active) {
    const names = devices.map((d) => d.name ?? "unnamed").join(", ");
    throw new SpotifyPlayError(
      `No active Spotify speaker. Start playback on one of these devices in Spotify first, then ask again: ${names}.`,
      "no_active_device",
    );
  }
  return active;
}

export async function searchSpotifyContext(
  fetchSpotify: SpotifyFetch,
  kind: SpotifyContentKind,
  query: string,
  artist?: string,
): Promise<Candidate> {
  const type = kind === "album" ? "album" : "playlist";
  const q = kind === "album" && artist ? `${query} ${artist}` : query;
  const out = await fetchSpotify(
    `/search?q=${encodeURIComponent(q)}&type=${type}&limit=10&market=from_token`,
  );
  if (out.status >= 400) {
    throw new SpotifyPlayError(
      `Spotify search failed (${out.status})${errorDetail(out.data)}`,
      "spotify_error",
    );
  }
  const data = out.data as {
    albums?: { items?: Array<Candidate | null> };
    playlists?: { items?: Array<Candidate | null> };
  } | null;
  const items = (kind === "album" ? data?.albums?.items : data?.playlists?.items) ?? [];
  const best = pickBestCandidate(items, query, kind === "album" ? artist : undefined);
  if (!best?.uri) {
    throw new SpotifyPlayError(
      `No ${kind === "album" ? "album" : "playlist"} found on Spotify for "${query}".`,
      "no_results",
    );
  }
  return best;
}

export async function playSpotifyContext(
  fetchSpotify: SpotifyFetch,
  input: { kind: SpotifyContentKind; query: string; artist?: string },
): Promise<SpotifyPlayResult> {
  const query = input.query.trim();
  if (!query) {
    throw new SpotifyPlayError(
      input.kind === "album"
        ? "Which album? Provide an album title in query."
        : "Which mood? Provide a mood or genre such as 'chill cooking' in query.",
      "no_results",
    );
  }
  const device = await findActiveDevice(fetchSpotify);
  const found = await searchSpotifyContext(fetchSpotify, input.kind, query, input.artist);
  const play = await fetchSpotify(
    `/me/player/play?device_id=${encodeURIComponent(device.id as string)}`,
    { method: "PUT", body: JSON.stringify({ context_uri: found.uri }) },
  );
  if (play.status === 404) {
    throw new SpotifyPlayError(
      "No active Spotify speaker. Open Spotify on the speaker, then ask again.",
      "no_active_device",
    );
  }
  if (play.status === 403) {
    throw new SpotifyPlayError(
      `Spotify refused playback${errorDetail(play.data)}. Playback control needs Spotify Premium and the user-modify-playback-state scope.`,
      "premium_required",
    );
  }
  if (play.status >= 400) {
    throw new SpotifyPlayError(
      `Spotify play failed (${play.status})${errorDetail(play.data)}`,
      "spotify_error",
    );
  }
  return {
    kind: input.kind,
    name: found.name ?? query,
    owner:
      input.kind === "album"
        ? (found.artists?.map((a) => a.name).filter(Boolean).join(", ") || null)
        : (found.owner?.display_name ?? null),
    uri: found.uri as string,
    device: device.name ?? "speaker",
  };
}
