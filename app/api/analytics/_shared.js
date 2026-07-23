import { Redis } from "@upstash/redis";

import {
  ANALYTICS_V1_START_DATE,
  ANALYTICS_V1_TRACKING_VERSION,
  createAnalyticsRetentionSummary,
  sanitizeAnalyticsEventPayload,
} from "../../../src/lib/analytics-v1.js";
import {
  getTaipeiDateKey,
  getTaipeiDateKeys,
  isUsageAdminAuthorized,
  sanitizeDeviceId,
} from "../../../src/lib/usage-stats.js";

export const ANALYTICS_KEY_PREFIX = "jj-invest-public:analytics:v1";
export const ANALYTICS_KEY_TTL_SECONDS = 60 * 60 * 24 * 400;

export function getRedisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}

export function getRedisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

export function getRedis() {
  const url = getRedisUrl();
  const token = getRedisToken();
  if (!url || !token) {
    return null;
  }

  return new Redis({ url, token });
}

export function isAdminAuthorized(request) {
  return isUsageAdminAuthorized(request.url, process.env.USAGE_ADMIN_TOKEN);
}

export function analyticsKeys(now = new Date()) {
  const today = getTaipeiDateKey(now);
  return {
    devices: `${ANALYTICS_KEY_PREFIX}:devices`,
    device: (anonymousId) => `${ANALYTICS_KEY_PREFIX}:device:${anonymousId}`,
    newDevices: (dateKey = today) => `${ANALYTICS_KEY_PREFIX}:devices:first:${dateKey}`,
    activeDevices: (dateKey = today) => `${ANALYTICS_KEY_PREFIX}:devices:active:${dateKey}`,
    sessions: `${ANALYTICS_KEY_PREFIX}:sessions`,
    session: (sessionId) => `${ANALYTICS_KEY_PREFIX}:session:${sessionId}`,
    deviceSessions: (anonymousId) => `${ANALYTICS_KEY_PREFIX}:sessions:device:${anonymousId}`,
    sessionsByDate: (dateKey = today) => `${ANALYTICS_KEY_PREFIX}:sessions:date:${dateKey}`,
    events: `${ANALYTICS_KEY_PREFIX}:events`,
    event: (eventId) => `${ANALYTICS_KEY_PREFIX}:event:${eventId}`,
    eventsByName: (eventName) => `${ANALYTICS_KEY_PREFIX}:events:name:${eventName}`,
    eventsByNameDate: (eventName, dateKey = today) =>
      `${ANALYTICS_KEY_PREFIX}:events:name:${eventName}:date:${dateKey}`,
    eventDevicesByName: (eventName) =>
      `${ANALYTICS_KEY_PREFIX}:events:name:${eventName}:devices`,
    eventDevicesByNameDate: (eventName, dateKey = today) =>
      `${ANALYTICS_KEY_PREFIX}:events:name:${eventName}:devices:${dateKey}`,
    daily: (dateKey = today) => `${ANALYTICS_KEY_PREFIX}:daily:${dateKey}`,
    rateLimit: (anonymousId, dateKey = today) =>
      `${ANALYTICS_KEY_PREFIX}:rate:${anonymousId}:${dateKey}`,
    versions: `${ANALYTICS_KEY_PREFIX}:versions`,
    versionActiveDevices: (version) =>
      `${ANALYTICS_KEY_PREFIX}:version:${version}:active_devices`,
    versionSessions: (version) => `${ANALYTICS_KEY_PREFIX}:version:${version}:sessions`,
    versionEventDevices: (version, eventName) =>
      `${ANALYTICS_KEY_PREFIX}:version:${version}:events:${eventName}:devices`,
  };
}

export function unauthorizedResponse() {
  return Response.json({ error: "未授權讀取 Analytics v1。" }, { status: 401 });
}

export function unconfiguredResponse() {
  return Response.json({ configured: false });
}

export function badRequestResponse(message) {
  return Response.json({ error: message }, { status: 400 });
}

export function sanitizeAnalyticsId(value) {
  return sanitizeDeviceId(value);
}

export function safeAppVersion(value) {
  return String(value || "").trim().slice(0, 40) || "dev";
}

export async function enforceRateLimit({ redis, anonymousId, now, limit = 300 }) {
  const keys = analyticsKeys(now);
  const today = getTaipeiDateKey(now);
  const key = keys.rateLimit(anonymousId, today);
  const count = await redis.incr(key);
  if (Number(count) === 1) {
    await redis.expire(key, 60 * 60 * 26);
  }

  return Number(count) <= limit;
}

export async function touchDevice({ redis, anonymousId, appVersion, now }) {
  const keys = analyticsKeys(now);
  const nowIso = now.toISOString();
  const today = getTaipeiDateKey(now);
  const isNewDevice = await redis.sadd(keys.devices, anonymousId);

  await Promise.all([
    redis.sadd(keys.activeDevices(today), anonymousId),
    redis.expire(keys.activeDevices(today), ANALYTICS_KEY_TTL_SECONDS),
    isNewDevice ? redis.sadd(keys.newDevices(today), anonymousId) : Promise.resolve(0),
    isNewDevice ? redis.expire(keys.newDevices(today), ANALYTICS_KEY_TTL_SECONDS) : Promise.resolve(0),
    redis.hset(keys.device(anonymousId), {
      anonymous_id: anonymousId,
      app_version: appVersion,
      last_seen_at: nowIso,
      tracking_version: ANALYTICS_V1_TRACKING_VERSION,
      updated_at: nowIso,
    }),
    redis.hsetnx(keys.device(anonymousId), "first_seen_at", nowIso),
    redis.hsetnx(keys.device(anonymousId), "created_at", nowIso),
    redis.sadd(keys.versions, appVersion),
    redis.sadd(keys.versionActiveDevices(appVersion), anonymousId),
  ]);

  return Boolean(isNewDevice);
}

export async function updateDailySnapshot(redis, dateKey, now = new Date()) {
  const keys = analyticsKeys(now);
  const eventNames = ["beta_calculated", "holding_added", "holding_deleted"];
  const [
    newDevices,
    activeDevices,
    sessions,
    betaEvents,
    holdingAddedEvents,
    holdingDeletedEvents,
  ] = await Promise.all([
    redis.scard(keys.newDevices(dateKey)),
    redis.scard(keys.activeDevices(dateKey)),
    redis.scard(keys.sessionsByDate(dateKey)),
    redis.scard(keys.eventsByNameDate(eventNames[0], dateKey)),
    redis.scard(keys.eventsByNameDate(eventNames[1], dateKey)),
    redis.scard(keys.eventsByNameDate(eventNames[2], dateKey)),
  ]);

  await Promise.all([
    redis.hset(keys.daily(dateKey), {
      date: dateKey,
      new_devices: Number(newDevices) || 0,
      active_devices: Number(activeDevices) || 0,
      sessions: Number(sessions) || 0,
      beta_calculated: Number(betaEvents) || 0,
      holding_added: Number(holdingAddedEvents) || 0,
      holding_deleted: Number(holdingDeletedEvents) || 0,
      updated_at: now.toISOString(),
    }),
    redis.expire(keys.daily(dateKey), ANALYTICS_KEY_TTL_SECONDS),
  ]);
}

export function sanitizeEventPayload(payload) {
  const sanitized = sanitizeAnalyticsEventPayload({
    eventName: payload.eventName,
    properties: payload.properties,
  });

  if (!sanitized) {
    return null;
  }

  const anonymousId = sanitizeAnalyticsId(payload.anonymousId);
  const sessionId = sanitizeAnalyticsId(payload.sessionId);
  const eventId = sanitizeAnalyticsId(payload.eventId);
  if (!anonymousId || !sessionId || !eventId) {
    return null;
  }

  return {
    anonymousId,
    appVersion: safeAppVersion(payload.appVersion),
    eventId,
    eventName: sanitized.eventName,
    properties: sanitized.properties,
    sessionId,
  };
}

export async function readAnalyticsAdminMetrics(redis, now = new Date()) {
  const keys = analyticsKeys(now);
  const today = getTaipeiDateKey(now);
  const sevenDayDates = getTaipeiDateKeys(7, now);
  const thirtyDayDates = getTaipeiDateKeys(30, now);
  const trendDates = getTaipeiDateKeys(30, now).reverse();
  const eventNames = ["beta_calculated", "holding_added", "holding_deleted"];

  const [totalDevices, totalSessions, totalEvents, dailyRows] = await Promise.all([
    redis.scard(keys.devices),
    redis.scard(keys.sessions),
    redis.scard(keys.events),
    Promise.all(trendDates.map((dateKey) => redis.hgetall(keys.daily(dateKey)))),
  ]);

  const [
    todayNewDevices,
    todayActiveDevices,
    dauDevices,
    wauDevices,
    mauDevices,
    todaySessions,
    sevenDaySessions,
  ] = await Promise.all([
    redis.scard(keys.newDevices(today)),
    redis.scard(keys.activeDevices(today)),
    redis.smembers(keys.activeDevices(today)),
    redis.sunion(...sevenDayDates.map((dateKey) => keys.activeDevices(dateKey))),
    redis.sunion(...thirtyDayDates.map((dateKey) => keys.activeDevices(dateKey))),
    redis.scard(keys.sessionsByDate(today)),
    Promise.all(sevenDayDates.map((dateKey) => redis.scard(keys.sessionsByDate(dateKey)))),
  ]);

  const eventMetrics = Object.fromEntries(
    await Promise.all(
      eventNames.map(async (eventName) => {
        const [totalCount, uniqueDevices, todayCount] = await Promise.all([
          redis.scard(keys.eventsByName(eventName)),
          redis.scard(keys.eventDevicesByName(eventName)),
          redis.scard(keys.eventsByNameDate(eventName, today)),
        ]);
        return [
          eventName,
          {
            totalCount: Number(totalCount) || 0,
            uniqueDevices: Number(uniqueDevices) || 0,
            todayCount: Number(todayCount) || 0,
          },
        ];
      }),
    ),
  );
  const versions = await redis.smembers(keys.versions);
  const versionMetrics = await Promise.all(
    (versions || []).map(async (version) => {
      const [activeDevices, sessions, betaDevices] = await Promise.all([
        redis.scard(keys.versionActiveDevices(version)),
        redis.scard(keys.versionSessions(version)),
        redis.scard(keys.versionEventDevices(version, "beta_calculated")),
      ]);
      return {
        version,
        activeDevices: Number(activeDevices) || 0,
        sessions: Number(sessions) || 0,
        betaDevices: Number(betaDevices) || 0,
      };
    }),
  );

  const sessions7Days = sevenDaySessions.reduce((total, count) => total + Number(count || 0), 0);
  const active7Days = new Set(wauDevices || []).size;
  const trend = trendDates.map((dateKey, index) => {
    const row = dailyRows[index] || {};
    return {
      date: dateKey,
      newDevices: Number(row.new_devices) || 0,
      activeDevices: Number(row.active_devices) || 0,
      sessions: Number(row.sessions) || 0,
      betaCalculated: Number(row.beta_calculated) || 0,
    };
  });

  const cohortDates = getTaipeiDateKeys(10, now).reverse();
  const cohorts = await Promise.all(
    cohortDates.map(async (dateKey) => ({
      date: dateKey,
      devices: await redis.smembers(keys.newDevices(dateKey)),
    })),
  );
  const retentionActiveDates = getTaipeiDateKeys(40, now);
  const activeByDateEntries = await Promise.all(
    retentionActiveDates.map(async (dateKey) => [
      dateKey,
      await redis.smembers(keys.activeDevices(dateKey)),
    ]),
  );

  return {
    analyticsVersion: "v1",
    configured: true,
    startDate: ANALYTICS_V1_START_DATE,
    overview: {
      totalDevices: Number(totalDevices) || 0,
      totalSessions: Number(totalSessions) || 0,
      totalEvents: Number(totalEvents) || 0,
      todayNewDevices: Number(todayNewDevices) || 0,
      dau: new Set(dauDevices || []).size,
      wau: active7Days,
      mau: new Set(mauDevices || []).size,
      todaySessions: Number(todaySessions) || 0,
      sessions7Days,
      averageWeeklySessionsPerActiveDevice:
        active7Days > 0 ? sessions7Days / active7Days : 0,
    },
    events: eventMetrics,
    retention: createAnalyticsRetentionSummary({
      cohorts,
      activeByDate: Object.fromEntries(activeByDateEntries),
      now,
    }),
    trend,
    versions: versionMetrics.sort((a, b) => b.activeDevices - a.activeDevices),
  };
}
