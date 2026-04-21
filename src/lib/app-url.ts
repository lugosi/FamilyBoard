export function getGoogleRedirectUri(request: Request): string {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) {
    return `${base}/api/auth/google/callback`;
  }
  const u = new URL(request.url);
  return `${u.origin}/api/auth/google/callback`;
}

export function getSpotifyRedirectUri(request: Request): string {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) {
    return `${base}/api/auth/spotify/callback`;
  }
  const u = new URL(request.url);
  return `${u.origin}/api/auth/spotify/callback`;
}

export function getAppOrigin(request: Request): string {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) return base;
  return new URL(request.url).origin;
}
