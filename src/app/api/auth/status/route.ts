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
import { getConfiguredPublicAppUrl } from "@/lib/app-url";
import { getStravaRedirectUri, isStravaConfigured, listStravaAccounts } from "@/lib/strava";
import { stravaTrainingSkillPresentInWiki } from "@/lib/wiki-skill-seeds";

export async function GET(request: Request) {
  const google = await readGoogleTokens();
  const spotify = await readSpotifyTokens();
  const hueIp = getHueBridgeIp();
  const hueUser = await readHueUsername();
  const weather = getWeatherCoordinates();
  const nestProjectId = getNestProjectId();
  const catlinkLinked = await isCatlinkLinked();
  const googleLinked = Boolean(google?.refresh_token);
  const stravaConfigured = isStravaConfigured();
  const wikiConfigured = isWikilmGithubConfigured();
  const stravaAccounts = stravaConfigured
    ? (await listStravaAccounts()).map((a) => ({
        accountKey: a.accountKey,
        displayName: a.displayName,
        athleteName: a.athleteName,
      }))
    : [];
  const stravaRedirectUri = getStravaRedirectUri(request);
  let stravaCallbackDomain = "";
  try {
    stravaCallbackDomain = new URL(stravaRedirectUri).hostname;
  } catch {
    stravaCallbackDomain = "";
  }

  let stravaTrainingSkillInWiki = false;
  if (stravaConfigured && wikiConfigured) {
    try {
      stravaTrainingSkillInWiki = await stravaTrainingSkillPresentInWiki();
    } catch {
      stravaTrainingSkillInWiki = false;
    }
  }

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
    wikilmGithubConfigured: wikiConfigured,
    gmailReady: googleLinked,
    inboxAutoScanMinutes: getInboxAutoScanMinutes(),
    slackConfigured: isSlackConfigured(),
    stravaConfigured,
    stravaAccounts,
    stravaRedirectUri,
    stravaCallbackDomain,
    stravaTrainingSkillInWiki,
    publicAppUrl: getConfiguredPublicAppUrl(),
  });
}
