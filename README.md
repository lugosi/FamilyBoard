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
