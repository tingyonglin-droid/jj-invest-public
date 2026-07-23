import {
  ANALYTICS_KEY_TTL_SECONDS,
  analyticsKeys,
  badRequestResponse,
  enforceRateLimit,
  getRedis,
  safeAppVersion,
  sanitizeAnalyticsId,
  touchDevice,
  unconfiguredResponse,
  updateDailySnapshot,
} from "../_shared.js";
import { ANALYTICS_V1_TRACKING_VERSION } from "../../../../src/lib/analytics-v1.js";
import { getTaipeiDateKey } from "../../../../src/lib/usage-stats.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const redis = getRedis();
  if (!redis) {
    return unconfiguredResponse();
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const anonymousId = sanitizeAnalyticsId(payload.anonymousId);
  const sessionId = sanitizeAnalyticsId(payload.sessionId);
  if (!anonymousId || !sessionId) {
    return badRequestResponse("Analytics session payload 格式不正確。");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const today = getTaipeiDateKey(now);
  const keys = analyticsKeys(now);
  const appVersion = safeAppVersion(payload.appVersion);
  const allowed = await enforceRateLimit({ redis, anonymousId, now });
  if (!allowed) {
    return Response.json({ error: "Analytics 寫入過於頻繁。" }, { status: 429 });
  }
  const isNewSession = await redis.sadd(keys.sessions, sessionId);

  try {
    await touchDevice({ redis, anonymousId, appVersion, now });
    await Promise.all([
      redis.sadd(keys.sessionsByDate(today), sessionId),
      redis.sadd(keys.deviceSessions(anonymousId), sessionId),
      redis.sadd(keys.versionSessions(appVersion), sessionId),
      redis.expire(keys.sessionsByDate(today), ANALYTICS_KEY_TTL_SECONDS),
      redis.hset(keys.session(sessionId), {
        anonymous_id: anonymousId,
        app_version: appVersion,
        last_activity_at: nowIso,
        session_id: sessionId,
        tracking_version: ANALYTICS_V1_TRACKING_VERSION,
      }),
      redis.hsetnx(keys.session(sessionId), "started_at", nowIso),
      redis.hsetnx(keys.session(sessionId), "created_at", nowIso),
    ]);
    await updateDailySnapshot(redis, today, now);

    return Response.json({
      configured: true,
      recorded: true,
      newSession: Boolean(isNewSession),
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Analytics session 寫入失敗。",
      },
      { status: 500 },
    );
  }
}
