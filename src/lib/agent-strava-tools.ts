import type { AgentTool, AgentToolContext } from "./agent";
import {
  buildStravaAuthorizeUrl,
  fetchStravaAthlete,
  getStravaAccount,
  isStravaConfigured,
  listCachedStravaActivities,
  summarizeStravaActivities,
  syncStravaActivityCache,
  type StravaAccountKey,
} from "./strava";

function accountKeyFromCtx(ctx: AgentToolContext): StravaAccountKey | null {
  return ctx.actor?.accountKey ?? null;
}

async function notLinkedResponse(ctx: AgentToolContext, accountKey: StravaAccountKey | null) {
  if (!isStravaConfigured()) {
    return {
      response: {
        linked: false,
        error: "strava_not_configured",
        hint: "Set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET on the server.",
      },
      label: "Strava not configured",
    };
  }
  if (!accountKey) {
    return {
      response: {
        linked: false,
        error: "strava_actor_required",
        hint:
          ctx.channel === "slack"
            ? "I couldn't tell who is asking in Slack."
            : "Pick who you are in the AI tab (Strava member), then try again.",
      },
      label: "Strava needs a person",
    };
  }
  const url = buildStravaAuthorizeUrl({
    accountKey,
    displayName: ctx.actor?.displayName,
    returnPath: ctx.channel === "slack" ? "/?tab=ai" : "/?tab=ai",
  });
  return {
    response: {
      linked: false,
      accountKey,
      authorizeUrl: url,
      hint:
        ctx.channel === "slack"
          ? `Open this link on your phone to connect *your* Strava: ${url}`
          : `Connect Strava for ${ctx.actor?.displayName || accountKey}: ${url}`,
    },
    label: "Strava not linked",
  };
}

function publicActivity(a: {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  start_date_local: string;
  distance_m: number;
  moving_time_s: number;
  elapsed_time_s?: number;
  total_elevation_gain_m?: number;
  average_speed_mps?: number;
  max_speed_mps?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  suffer_score?: number;
}) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    sport_type: a.sport_type,
    start_date_local: a.start_date_local,
    distance_m: a.distance_m,
    moving_time_s: a.moving_time_s,
    elapsed_time_s: a.elapsed_time_s,
    total_elevation_gain_m: a.total_elevation_gain_m,
    average_speed_mps: a.average_speed_mps,
    max_speed_mps: a.max_speed_mps,
    average_heartrate: a.average_heartrate,
    max_heartrate: a.max_heartrate,
    suffer_score: a.suffer_score,
  };
}

export function buildStravaTools(): AgentTool[] {
  if (!isStravaConfigured()) return [];

  return [
    {
      declaration: {
        name: "strava_athlete",
        description:
          "Get the current person's linked Strava athlete profile (name, city, bikes/shoes counts). Each family member links their own Strava. If not linked, returns an authorize URL for that person.",
        parameters: { type: "object", properties: {} },
      },
      async run(_args, ctx) {
        const accountKey = accountKeyFromCtx(ctx);
        if (!accountKey || !(await getStravaAccount(accountKey))) {
          return notLinkedResponse(ctx, accountKey);
        }
        try {
          const athlete = await fetchStravaAthlete(accountKey);
          return {
            response: {
              linked: true,
              accountKey,
              athlete: {
                id: athlete.id,
                username: athlete.username,
                firstname: athlete.firstname,
                lastname: athlete.lastname,
                city: athlete.city,
                state: athlete.state,
                country: athlete.country,
                sex: athlete.sex,
                premium: athlete.premium,
                created_at: athlete.created_at,
                weight: athlete.weight,
              },
            },
            label: "Strava athlete",
          };
        } catch (e) {
          return {
            response: {
              linked: true,
              error: e instanceof Error ? e.message : "strava_error",
            },
            label: "Strava athlete failed",
          };
        }
      },
    },
    {
      declaration: {
        name: "strava_recent_activities",
        description:
          "List recent Strava activities for the current person from a local 30-day cache (first call bootstraps last 30 days; later calls only pull new activities). Use for last run/ride or a short list. Prefer strava_training_summary for week/month totals.",
        parameters: {
          type: "object",
          properties: {
            per_page: {
              type: "number",
              description: "How many activities to return (1–30, default 10).",
            },
          },
        },
      },
      async run(args, ctx) {
        const accountKey = accountKeyFromCtx(ctx);
        if (!accountKey || !(await getStravaAccount(accountKey))) {
          return notLinkedResponse(ctx, accountKey);
        }
        const perPage =
          typeof args.per_page === "number" && args.per_page > 0
            ? Math.min(Math.floor(args.per_page), 30)
            : 10;
        try {
          const sync = await syncStravaActivityCache(accountKey);
          const rows = await listCachedStravaActivities(accountKey, { limit: perPage });
          return {
            response: {
              linked: true,
              accountKey,
              sync: {
                mode: sync.mode,
                fetched: sync.fetched,
                upserted: sync.upserted,
                total: sync.total,
                windowDays: sync.windowDays,
              },
              count: rows.length,
              activities: rows.map(publicActivity),
            },
            label: `Strava activities (${rows.length}, ${sync.mode})`,
          };
        } catch (e) {
          return {
            response: {
              linked: true,
              error: e instanceof Error ? e.message : "strava_error",
            },
            label: "Strava activities failed",
          };
        }
      },
    },
    {
      declaration: {
        name: "strava_training_summary",
        description:
          "Summarize the current person's last 30 days of Strava training (totals, by sport, Monday week buckets for week-over-week, recent highlights). Syncs the local cache first (bootstrap 30 days, then diff). Use for mileage, volume, how training is going, week/month recap — not Strava's official MCP analytics.",
        parameters: { type: "object", properties: {} },
      },
      async run(_args, ctx) {
        const accountKey = accountKeyFromCtx(ctx);
        if (!accountKey || !(await getStravaAccount(accountKey))) {
          return notLinkedResponse(ctx, accountKey);
        }
        try {
          const sync = await syncStravaActivityCache(accountKey);
          const rows = await listCachedStravaActivities(accountKey);
          const summary = summarizeStravaActivities(rows);
          return {
            response: {
              linked: true,
              accountKey,
              sync: {
                mode: sync.mode,
                fetched: sync.fetched,
                upserted: sync.upserted,
                pruned: sync.pruned,
                total: sync.total,
                windowDays: sync.windowDays,
              },
              summary,
            },
            label: `Strava summary (${summary.activityCount} in ${summary.windowDays}d, ${sync.mode})`,
          };
        } catch (e) {
          return {
            response: {
              linked: true,
              error: e instanceof Error ? e.message : "strava_error",
            },
            label: "Strava summary failed",
          };
        }
      },
    },
  ];
}
