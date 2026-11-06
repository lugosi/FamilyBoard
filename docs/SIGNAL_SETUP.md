# Signal bot on TrueNAS

Family members text a dedicated Signal number; FamilyBoard answers with the same assistant as the AI tab (calendar, todos, inbox, wiki). Gemini still does the thinking. Signal is only the chat channel.

```
phone (Signal app) ──► Signal servers ◄── signal-cli-rest-api (TrueNAS app) ◄── FamilyBoard polls /v1/receive every few seconds
                                                                              └─► runs the agent, replies via /v2/send
```

## 1. Get a number for the bot

The bot needs its **own** number. Registering a number with signal-cli signs the Signal phone app out of that number, so never use a family member's personal number.

- A cheap prepaid SIM or a landline works best. For a landline, tick “Call with the code” during registration.
- Google Voice / VoIP numbers sometimes work but are often rejected by Signal.
- You only need the number to receive one verification code, plus a re-verify if Signal ever asks again.

## 2. Run signal-cli-rest-api on TrueNAS

TrueNAS → Apps → Discover → **Custom App** (or Install via YAML):

```yaml
services:
  signal-cli-rest-api:
    image: bbernhard/signal-cli-rest-api:latest
    restart: unless-stopped
    environment:
      - MODE=native
      # Do NOT set AUTO_RECEIVE_SCHEDULE: FamilyBoard is the receiver; that cron would eat messages.
    ports:
      - "8080:8080"   # LAN only; do not expose this to the internet
    volumes:
      - /mnt/<pool>/apps/signal-cli:/home/.local/share/signal-cli
```

- Mount a persistent dataset: it holds the account keys. Back it up. Losing it means re-registering.
- The API has **no authentication**. Keep port 8080 on the LAN (or don't publish it at all and put both apps on one Docker network).

Check it: `curl http://<truenas-ip>:8080/v1/about` should return JSON with `"mode":"native"`.

## 3. Point FamilyBoard at it

In the FamilyBoard app's environment:

| Variable | Example | Notes |
|----------|---------|-------|
| `SIGNAL_API_URL` | `http://192.168.1.20:8080` | URL of the container above, as reachable from FamilyBoard |
| `SIGNAL_NUMBER` | `+15551234567` | The bot's number, E.164 |
| `SIGNAL_ALLOWED_SENDERS` | `+15550001111=Mom,+15550002222=Dad` | Only these people get answers; everyone else is ignored silently. `=Name` is optional. |
| `SIGNAL_BOT_NAME` | `FamilyBoard` | Optional profile name set after registration |
| `SIGNAL_POLL_SECONDS` | `5` | Optional, minimum 2 |

Restart FamilyBoard. The log should show `[signal] bot polling started`.

## 4. Register the account (in FamilyBoard)

Open the **AI** tab → **Signal** panel:

1. Open the [Signal captcha page](https://signalcaptchas.org/registration/generate.html), solve it, then right-click **Open Signal** → copy link (starts with `signalcaptcha://`).
2. Paste it and press **Send code**. Captchas expire within a minute or two, so paste quickly.
3. Enter the 6-digit SMS (or voice) code → **Verify**. If the number had a Signal registration lock, also enter its PIN.
4. Press **Say hello**: everyone on the allowlist gets a first message, so they can save the contact.

Equivalent curl, if you prefer:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"captcha":"signalcaptcha://…"}' http://<truenas-ip>:8080/v1/register/+15551234567
curl -X POST http://<truenas-ip>:8080/v1/register/+15551234567/verify/123456
```

## Using it

- Text in plain language: “dentist for Maya next Tuesday 3pm”, “what's on Saturday?”, “move soccer to 10”, “check the inbox”.
- The bot remembers the last few messages for 30 minutes, so follow-ups like “make it 4pm instead” work. Send `reset` to start over.
- Group chats are ignored in v1; message the bot directly.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Panel says “Signal API unreachable” | Wrong `SIGNAL_API_URL`, or the container is down / on another network |
| `Captcha required` / `Invalid captcha` | Get a fresh captcha and paste it right away |
| Rate limited during registration | Wait a few hours; Signal throttles repeated attempts |
| Messages arrive but no reply | The sender isn't in `SIGNAL_ALLOWED_SENDERS` (the “ignored” count goes up), or `GEMINI_API_KEY` is missing |
| “Listening: no” | FamilyBoard started before `SIGNAL_*` was set; restart the app |
