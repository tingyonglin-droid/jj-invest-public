import {
  ANALYTICS_KEY_TTL_SECONDS,
  analyticsKeys,
  badRequestResponse,
  enforceRateLimit,
  getRedis,
  sanitizeEventPayload,
  touchDevice,
  unconfiguredResponse,
  updateDailySnapshot,
} from "../_shared.js";
import { createAnalyticsEvent } from "../../../../src/lib/analytics-v1.js";
import { getTaipeiDateKey } from "../../../../src/lib/usage-stats.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const redis = getRedis();
  if (!redis) {
    return unconfiguredResponse();
  }

  let rawPayload;
  try {
    rawPayload = await request.json();
  } catch {
    rawPayload = {};
  }

  const payload = sanitizeEventPayload(rawPayload);
  if (!payload) {
    return badRequestResponse("Analytics event payload 格式不正確。");
  }

  const now = new Date();
  const today = getTaipeiDateKey(now);
  const keys = analyticsKeys(now);
  const allowed = await enforceRateLimit({
    redis,
    anonymousId: payload.anonymousId,
    now,
  });
  if (!allowed) {
    return Response.json({ error: "Analytics 寫入過於頻繁。" }, { status: 429 });
  }
  const event = createAnalyticsEvent({
    anonymousId: payload.anonymousId,
    appVersion: payload.appVersion,
    eventId: payload.eventId,
    eventName: payload.eventName,
    properties: payload.properties,
    sessionId: payload.sessionId,
    now,
  });

  if (!event) {
    return badRequestResponse("Analytics event 不在白名單內。");
  }

  try {
    await touchDevice({
      redis,
      anonymousId: payload.anonymousId,
      appVersion: payload.appVersion,
      now,
    });
    const isNewEvent = await redis.sadd(keys.events, payload.eventId);

    if (!isNewEvent) {
      return Response.json({
        configured: true,
        duplicate: true,
        recorded: false,
      });
    }

    await Promise.all([
      redis.hset(keys.event(payload.eventId), event),
      redis.sadd(keys.eventsByName(payload.eventName), payload.eventId),
      redis.sadd(keys.eventsByNameDate(payload.eventName, today), payload.eventId),
      redis.sadd(keys.eventDevicesByName(payload.eventName), payload.anonymousId),
      redis.sadd(keys.eventDevicesByNameDate(payload.eventName, today), payload.anonymousId),
      redis.sadd(
        keys.versionEventDevices(payload.appVersion, payload.eventName),
        payload.anonymousId,
      ),
      redis.expire(keys.eventsByNameDate(payload.eventName, today), ANALYTICS_KEY_TTL_SECONDS),
      redis.expire(keys.eventDevicesByNameDate(payload.eventName, today), ANALYTICS_KEY_TTL_SECONDS),
    ]);
    await updateDailySnapshot(redis, today, now);

    return Response.json({
      configured: true,
      recorded: true,
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Analytics event 寫入失敗。",
      },
      { status: 500 },
    );
  }
}
