import { Redis } from "@upstash/redis";

import {
  createUsageMetrics,
  createUsageTrend,
  getTaipeiDateKey,
  getTaipeiDateKeys,
  isUsageAdminAuthorized,
  sanitizeDeviceId,
} from "../../../src/lib/usage-stats.js";

export const dynamic = "force-dynamic";

const KEY_PREFIX = "jj-invest-public:usage";
const DAILY_KEY_TTL_SECONDS = 60 * 60 * 24 * 120;

function hasRedisConfig() {
  return Boolean(getRedisUrl() && getRedisToken());
}

function getRedisUrl() {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}

function getRedisToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

function getAdminToken() {
  return process.env.USAGE_ADMIN_TOKEN;
}

function getRedis() {
  if (!hasRedisConfig()) {
    return null;
  }

  return new Redis({
    url: getRedisUrl(),
    token: getRedisToken(),
  });
}

function usageKeys(now = new Date()) {
  const today = getTaipeiDateKey(now);
  return {
    allDevices: `${KEY_PREFIX}:devices`,
    totalOpens: `${KEY_PREFIX}:opens:total`,
    todayDevices: `${KEY_PREFIX}:active:${today}`,
    todayOpens: `${KEY_PREFIX}:opens:${today}`,
    todaySnapshot: `${KEY_PREFIX}:snapshot:${today}`,
    snapshot: (dateKey) => `${KEY_PREFIX}:snapshot:${dateKey}`,
    device: (deviceId) => `${KEY_PREFIX}:device:${deviceId}`,
  };
}

function unconfiguredResponse() {
  return Response.json({
    configured: false,
    totalDevices: 0,
    totalOpens: 0,
    activeToday: 0,
    active7Days: 0,
    active30Days: 0,
    opensToday: 0,
  });
}

async function readUsageMetrics(redis, now = new Date()) {
  const today = getTaipeiDateKey(now);
  const trendDates = getTaipeiDateKeys(30, now).reverse();
  const sevenDayKeys = getTaipeiDateKeys(7, now).map((dateKey) => `${KEY_PREFIX}:active:${dateKey}`);
  const thirtyDayKeys = getTaipeiDateKeys(30, now).map((dateKey) => `${KEY_PREFIX}:active:${dateKey}`);
  const snapshotKeys = trendDates.map((dateKey) => `${KEY_PREFIX}:snapshot:${dateKey}`);

  const [
    totalDevices,
    totalOpens,
    todayDevices,
    sevenDayDevices,
    thirtyDayDevices,
    opensToday,
    trendSnapshots,
  ] = await Promise.all([
    redis.scard(`${KEY_PREFIX}:devices`),
    redis.get(`${KEY_PREFIX}:opens:total`),
    redis.smembers(`${KEY_PREFIX}:active:${today}`),
    redis.sunion(...sevenDayKeys),
    redis.sunion(...thirtyDayKeys),
    redis.get(`${KEY_PREFIX}:opens:${today}`),
    Promise.all(snapshotKeys.map((key) => redis.hgetall(key))),
  ]);

  const metrics = createUsageMetrics({
    totalDevices,
    totalOpens,
    todayDevices,
    sevenDayDevices,
    thirtyDayDevices,
    opensToday,
  });
  const snapshots = Object.fromEntries(
    trendDates
      .map((dateKey, index) => [dateKey, trendSnapshots[index]])
      .filter(([, snapshot]) => snapshot && Object.keys(snapshot).length > 0),
  );

  if (!snapshots[today]) {
    snapshots[today] = {
      totalDevices: metrics.totalDevices,
      totalOpens: metrics.totalOpens,
    };
  }

  return {
    ...metrics,
    trend: createUsageTrend({
      dates: trendDates,
      snapshots,
    }),
  };
}

export async function GET(request) {
  if (!isUsageAdminAuthorized(request.url, getAdminToken())) {
    return Response.json(
      {
        error: "未授權讀取使用統計。",
      },
      { status: 401 },
    );
  }

  const redis = getRedis();

  if (!redis) {
    return unconfiguredResponse();
  }

  try {
    return Response.json(await readUsageMetrics(redis));
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "使用統計讀取失敗。",
      },
      { status: 500 },
    );
  }
}

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

  const deviceId = sanitizeDeviceId(payload.deviceId);

  if (!deviceId) {
    return Response.json(
      {
        error: "匿名裝置 ID 格式不正確。",
      },
      { status: 400 },
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const keys = usageKeys(now);

  try {
    await Promise.all([
      redis.sadd(keys.todayDevices, deviceId),
      redis.incr(keys.totalOpens),
      redis.incr(keys.todayOpens),
      redis.hset(keys.device(deviceId), {
        lastSeenAt: nowIso,
      }),
      redis.hsetnx(keys.device(deviceId), "firstSeenAt", nowIso),
      redis.expire(keys.todayDevices, DAILY_KEY_TTL_SECONDS),
      redis.expire(keys.todayOpens, DAILY_KEY_TTL_SECONDS),
    ]);
    await redis.sadd(keys.allDevices, deviceId);
    const [totalDevices, totalOpens] = await Promise.all([
      redis.scard(keys.allDevices),
      redis.get(keys.totalOpens),
    ]);
    await Promise.all([
      redis.hset(keys.todaySnapshot, {
        totalDevices: Number(totalDevices) || 0,
        totalOpens: Number(totalOpens) || 0,
      }),
      redis.expire(keys.todaySnapshot, DAILY_KEY_TTL_SECONDS),
    ]);

    await readUsageMetrics(redis, now);

    return Response.json({
      configured: true,
      recorded: true,
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "使用統計寫入失敗。",
      },
      { status: 500 },
    );
  }
}
