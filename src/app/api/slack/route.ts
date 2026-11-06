import { NextResponse } from "next/server";
import { getSlackConfig, slackAuthTest } from "@/lib/slack";
import { getSlackBotState } from "@/lib/slack-bot";

export async function GET() {
  if (!getSlackConfig()) {
    return NextResponse.json(
      { error: "Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN", configured: false },
      { status: 501 },
    );
  }
  const bot = getSlackBotState();
  try {
    const auth = await slackAuthTest();
    return NextResponse.json({
      configured: true,
      team: auth.team,
      botName: auth.botName,
      botUserId: auth.botUserId,
      bot,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "slack_error";
    return NextResponse.json({ configured: true, bot, error: message }, { status: 502 });
  }
}
