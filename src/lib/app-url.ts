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

/** Redirect URI for Nest Partner Connections Manager (must be on the OAuth Web client). */
export function getNestPcmRedirectUri(request: Request): string {
  const override = process.env.NEST_PCM_REDIRECT_URI?.trim();
  if (override) return override;
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) {
    return `${base}/api/auth/nest/pcm/callback`;
  }
  const u = new URL(request.url);
  return `${u.origin}/api/auth/nest/pcm/callback`;
}

export function getConfiguredPublicAppUrl(): string | null {
  const base = process.env.PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return base || null;
}
