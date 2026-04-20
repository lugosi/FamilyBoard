# Family board

Next.js app for a home display: **Google Calendar** (compact month-style grid), **weather** (Open-Meteo), and **Philips Hue** lights. Intended to run in Docker on a home server (for example TrueNAS Community Edition).

## Quick start

```bash
npm install
cp .env.example .env.local
# Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_APP_URL, optional WEATHER_*, HUE_*
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), use **Link Google**, then authorize Calendar access.

## Environment

See `.env.example`. Use a writable `DATA_DIR` in production so OAuth tokens and Hue pairing survive restarts.

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
