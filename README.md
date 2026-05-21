# Family board

Next.js app for a home display: **Google Calendar** (compact month-style grid), **weather** (Open-Meteo), **Philips Hue** lights, and **Spotify** playback controls. Intended to run in Docker on a home server (for example TrueNAS Community Edition).

## Quick start

```bash
npm install
cp .env.example .env.local
# Set GOOGLE_*, SPOTIFY_*, PUBLIC_APP_URL, optional WEATHER_*, HUE_*
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then use **Link Google** and **Link Spotify** in the dashboard.

## Environment

See `.env.example`. Use a writable `DATA_DIR` in production so OAuth tokens and Hue pairing survive restarts.

### Google Calendar + Nest (why a new OAuth client?)

FamilyBoard uses **one** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for both Calendar and Nest. Nest is a separate env value:

| Variable | What it is |
| -------- | ---------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth **Web client** from [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials |
| `GOOGLE_NEST_PROJECT_ID` | **Device Access enterprise UUID** from [Google Device Access](https://console.nest.google.com/device-access) (not the OAuth client id and not the numeric GCP project number) |

[Nest Device Access](https://developers.google.com/nest/device-access/get-started) only works when a **Google Cloud project is linked** to your Device Access enterprise. Google expects the OAuth app (client id) to live in **that same linked GCP project**, with the **Smart Device Management API** enabled there.

If Calendar was already set up under a different GCP project, enabling Nest often means:

1. Creating (or choosing) a GCP project in the Device Access console and linking it.
2. Enabling **Smart Device Management API** on that project.
3. Creating a **new** OAuth Web client in that project’s Credentials page.
4. Setting `GOOGLE_NEST_PROJECT_ID` to the enterprise UUID from Device Access.
5. Replacing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` with the new client, then **disconnecting and re-linking Google** in the app (tokens are bound to the client that issued them).

The Indoor widget **Debug** button or `GET /api/nest/debug` helps verify enterprise id, `sdm.service` scope, and device list after re-linking.

Spotify OAuth redirect URI must be added in your Spotify app settings:

- `${PUBLIC_APP_URL}/api/auth/spotify/callback`

Spotify Web Playback SDK is enabled for the in-browser player. Your Spotify app must include
the scopes used by this project (`streaming`, `user-read-email`, `user-read-private`,
`user-read-playback-state`, `user-read-currently-playing`, `user-modify-playback-state`).
If you linked Spotify before these scopes were added, disconnect and link again.

### TrueNAS port configuration

You can change the app listen port at runtime with `APP_PORT` (default `3000`).

- In TrueNAS **Edit** for the app, set env var `APP_PORT` to your target internal port.
- Update the app **container port mapping** to match the same internal port.
- Update `PUBLIC_APP_URL` to include the external host/port users open in a browser.
- Keep Google OAuth redirect URI synced: `${PUBLIC_APP_URL}/api/auth/google/callback`.
- Keep Spotify OAuth redirect URI synced: `${PUBLIC_APP_URL}/api/auth/spotify/callback`.

## Publish with GitHub (recommended for TrueNAS)

Pushes to `main` build the image and push to **GitHub Container Registry** via Actions.

- Image: **`ghcr.io/lugosi/familyboard:latest`** (replace `lugosi` if you fork).
- After the first run: GitHub → **Packages** → **familyboard** → **Package settings** → set visibility to **Public** if you want TrueNAS to pull without registry login.

TrueNAS Custom App → image repository `ghcr.io/lugosi/familyboard`, tag `latest`.

## Docker (local)

```bash
docker build -t family-board .
docker run --rm -p 3000:3000 -v family-board-data:/data --env-file .env.local family-board
```

## Scripts

| Command   | Description        |
| --------- | ------------------ |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint |

## License

Private / your choice.
