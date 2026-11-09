# Slack bot

Talk to FamilyBoard's assistant from the Slack mobile app: add or move calendar events, check the week, manage todos, process the inbox. Gemini still does the thinking. Slack is only the chat channel.

FamilyBoard connects **out** to Slack over Socket Mode, so there is no public URL, port forward, or extra container. It works from TrueNAS behind your router.

Where it answers:

- **DMs**: message the bot directly (Slack app, then the FamilyBoard app's Messages tab, or search for it).
- **Channels**: invite it (`/invite @FamilyBoard`), then `@FamilyBoard dentist for Maya Tuesday 3pm`. It replies in a thread; follow-ups in that thread need the @mention too and share the thread's context.
- Anyone in the workspace can use it, so keep the workspace family-only.

## 1. Create the app (2 minutes)

1. Go to <https://api.slack.com/apps>, then **Create New App**, then **From a manifest**, then pick your workspace.
2. Paste this manifest (YAML) and create:

```yaml
display_information:
  name: FamilyBoard
  description: Family calendar, todos, and inbox assistant
  background_color: "#0f172a"
features:
  app_home:
    home_tab_enabled: false
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: FamilyBoard
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - im:history
      - im:read
      - im:write
      - reactions:write
      - users:read
      - files:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```

3. **Basic Information**, then **App-Level Tokens**, then **Generate Token and Scopes**: name it `socket`, add scope `connections:write`, and generate. Copy the `xapp-…` token.
4. Under **Interactivity & Shortcuts**, confirm **Interactivity** is On (Socket Mode delivers button clicks; no Request URL needed).
5. **Install App**, then **Install to Workspace**, then allow. Copy the **Bot User OAuth Token** (`xoxb-…`).

If the app already exists: turn **Interactivity** on, set the manifest’s `interactivity.is_enabled: true`, then **reinstall** the app so Approve / Deny buttons work.

## 2. Give FamilyBoard the tokens

In the FamilyBoard app's environment on TrueNAS (not in chat or git):

| Variable | Value |
|----------|-------|
| `SLACK_BOT_TOKEN` | `xoxb-…` |
| `SLACK_APP_TOKEN` | `xapp-…` |

Restart FamilyBoard. The log shows `[slack] Socket Mode bot starting`, and the AI tab's **Slack** panel shows the workspace, `@familyboard`, and `Connected: yes`.

## 3. Use it

- DM: "what's on Saturday?", "move soccer to 10", "add dentist for Maya next Tuesday 3pm", "check the inbox".
- The bot puts 👀 on your message while it works, then replies, with a ✅ line for each change it made.
- Calendar / wiki writes need a quick review: the bot shows **Approve** and **Deny** buttons (you can still reply `approve` / `deny`).
- It remembers the last 30 minutes of a DM or channel thread, so "make it 4pm instead" works. Send `reset` to start over.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Slack panel: `invalid_auth` / `not_authed` | Wrong or revoked `SLACK_BOT_TOKEN`; reinstall the app and copy the new token |
| Connected: reconnecting… with `apps.connections.open` error | `SLACK_APP_TOKEN` missing the `connections:write` scope, or Socket Mode is off |
| DMs say "Sending messages to this app has been turned off" | App Home → enable **Messages Tab** and "Allow users to send…", then reinstall |
| No reply in a channel | Invite the bot to the channel and @mention it |
| Bot replies "assistant isn't set up yet" | Set `GEMINI_API_KEY` |
| Changes to scopes/events | Reinstall the app after editing the manifest |
| Approval message has no Approve / Deny buttons | Turn **Interactivity** on (manifest `interactivity.is_enabled: true`), then reinstall; Socket Mode must be enabled |
