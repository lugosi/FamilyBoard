import type { AgentTool, AgentToolContext } from "./agent";
import {
  buildStravaAuthorizeUrl,
  fetchStravaAthlete,
  getStravaAccount,
  isStravaConfigured,
  listStravaActivities,
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
          "List recent Strava activities for the current person (runs, rides, etc.). Use when they ask about workouts, mileage, last run/ride, or training this week. If not linked, returns their personal authorize URL.",
        parameters: {
          type: "object",
          properties: {
            per_page: {
              type: "number",
              description: "How many activities to return (1–30, default 10).",
            },
            page: { type: "number", description: "Page number (default 1)." },
            after_unix: {
              type: "number",
              description: "Only activities after this Unix epoch seconds.",
            },
            before_unix: {
              type: "number",
              description: "Only activities before this Unix epoch seconds.",
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
        const page =
          typeof args.page === "number" && args.page > 0 ? Math.floor(args.page) : 1;
        const after =
          typeof args.after_unix === "number" ? Math.floor(args.after_unix) : undefined;
        const before =
          typeof args.before_unix === "number" ? Math.floor(args.before_unix) : undefined;
        try {
          const rows = await listStravaActivities(accountKey, {
            page,
            perPage,
            after,
            before,
          });
          const activities = rows.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            sport_type: a.sport_type,
            start_date_local: a.start_date_local,
            distance_m: a.distance,
            moving_time_s: a.moving_time,
            elapsed_time_s: a.elapsed_time,
            total_elevation_gain_m: a.total_elevation_gain,
            average_speed_mps: a.average_speed,
            max_speed_mps: a.max_speed,
            average_heartrate: a.average_heartrate,
            max_heartrate: a.max_heartrate,
          }));
          return {
            response: { linked: true, accountKey, count: activities.length, activities },
            label: `Strava activities (${activities.length})`,
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
  ];
}
