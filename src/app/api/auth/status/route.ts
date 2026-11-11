import { NextResponse } from "next/server";
import { getNestProjectId, readGoogleTokens } from "@/lib/google";
import { getHueBridgeIp, readHueUsername } from "@/lib/hue";
import { readSpotifyTokens } from "@/lib/spotify";
import { getWeatherCoordinates } from "@/lib/weather";
import { getCatlinkEnvReady, isCatlinkLinked } from "@/lib/catlink";
import { isGeminiConfigured } from "@/lib/gemini";
import { isWikilmGithubConfigured } from "@/lib/wikilm-github";
import { isSlackConfigured } from "@/lib/slack";
import { getInboxAutoScanMinutes } from "@/lib/background";
import { isStravaConfigured, listStravaAccounts } from "@/lib/strava";

export async function GET() {
  const google = await readGoogleTokens();
  const spotify = await readSpotifyTokens();
  const hueIp = getHueBridgeIp();
  const hueUser = await readHueUsername();
  const weather = getWeatherCoordinates();
  const nestProjectId = getNestProjectId();
  const catlinkLinked = await isCatlinkLinked();
  const googleLinked = Boolean(google?.refresh_token);
  const stravaConfigured = isStravaConfigured();
  const stravaAccounts = stravaConfigured
    ? (await listStravaAccounts()).map((a) => ({
        accountKey: a.accountKey,
        displayName: a.displayName,
        athleteName: a.athleteName,
      }))
    : [];

  return NextResponse.json({
    googleLinked,
    googleConfigured: Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
    ),
    spotifyLinked: Boolean(spotify?.refresh_token),
    spotifyConfigured: Boolean(
      process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET,
    ),
    hueReady: Boolean(hueIp && hueUser),
    hueBridgeIp: hueIp,
    huePaired: Boolean(hueUser),
    weatherConfigured: Boolean(weather),
    nestConfigured: Boolean(nestProjectId),
    catlinkLinked,
    catlinkConfigured: catlinkLinked || getCatlinkEnvReady(),
    geminiConfigured: isGeminiConfigured(),
    wikilmGithubConfigured: isWikilmGithubConfigured(),
    gmailReady: googleLinked,
    inboxAutoScanMinutes: getInboxAutoScanMinutes(),
    slackConfigured: isSlackConfigured(),
    stravaConfigured,
    stravaAccounts,
  });
}
