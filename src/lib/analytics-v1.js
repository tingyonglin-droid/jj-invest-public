import { getTaipeiDateKey } from "./usage-stats.js";

export const ANALYTICS_V1_TRACKING_VERSION = "analytics_v1";
export const ANALYTICS_V1_EVENT_NAMES = [
  "beta_calculated",
  "holding_added",
  "holding_deleted",
  "portfolio_completed",
];
export const ANALYTICS_V1_START_DATE = "2026-07-23";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const ALLOWED_ASSET_TYPES = new Set(["leveraged", "original", "unknown"]);
const ALLOWED_MARKETS = new Set(["TW", "US", "unknown"]);
const ALLOWED_RESULT_STATUSES = new Set([
  "within_tolerance",
  "rebalance_needed",
  "invalid",
]);
const ALLOWED_HOLDING_BUCKETS = new Set(["0", "1", "2-3", "4-5", "6+"]);

export function getAnalyticsAppVersion(value) {
  return String(value || "").trim() || "dev";
}

export function createSessionState({
  currentSession,
  now = new Date(),
  appVersion,
  createId,
}) {
  const nowIso = now.toISOString();
  const previousActivityAt = currentSession?.lastActivityAt
    ? new Date(currentSession.lastActivityAt).getTime()
    : NaN;
  const currentTime = now.getTime();
  const canResume =
    currentSession?.sessionId &&
    Number.isFinite(previousActivityAt) &&
    currentTime - previousActivityAt <= SESSION_TIMEOUT_MS;

  return {
    appVersion: getAnalyticsAppVersion(appVersion),
    lastActivityAt: nowIso,
    sessionId: canResume ? currentSession.sessionId : createId(),
    shouldCreate: !canResume,
    trackingVersion: ANALYTICS_V1_TRACKING_VERSION,
  };
}

export function getHoldingCountBucket(count) {
  const safeCount = Number(count) || 0;
  if (safeCount <= 0) {
    return "0";
  }
  if (safeCount === 1) {
    return "1";
  }
  if (safeCount <= 3) {
    return "2-3";
  }
  if (safeCount <= 5) {
    return "4-5";
  }
  return "6+";
}

function sanitizeStringEnum(value, allowed, fallback = "unknown") {
  const text = String(value || "").trim();
  return allowed.has(text) ? text : fallback;
}

function sanitizeProperties(eventName, properties = {}) {
  if (eventName === "beta_calculated") {
    return {
      holding_count_bucket: sanitizeStringEnum(
        properties.holding_count_bucket,
        ALLOWED_HOLDING_BUCKETS,
        "0",
      ),
      result_status: sanitizeStringEnum(
        properties.result_status,
        ALLOWED_RESULT_STATUSES,
        "invalid",
      ),
    };
  }

  if (eventName === "holding_added" || eventName === "holding_deleted") {
    return {
      asset_type: sanitizeStringEnum(properties.asset_type, ALLOWED_ASSET_TYPES),
      market: sanitizeStringEnum(properties.market, ALLOWED_MARKETS),
    };
  }

  if (eventName === "portfolio_completed") {
    return {};
  }

  return {};
}

export function sanitizeAnalyticsEventPayload({ eventName, properties }) {
  if (!ANALYTICS_V1_EVENT_NAMES.includes(eventName)) {
    return null;
  }

  return {
    eventName,
    properties: sanitizeProperties(eventName, properties),
  };
}

export function createAnalyticsEvent({
  anonymousId,
  sessionId,
  eventName,
  eventId,
  appVersion,
  properties,
  now = new Date(),
}) {
  const sanitized = sanitizeAnalyticsEventPayload({ eventName, properties });
  if (!sanitized) {
    return null;
  }

  return {
    anonymous_id: anonymousId,
    app_version: getAnalyticsAppVersion(appVersion),
    created_at: now.toISOString(),
    event_id: eventId,
    event_name: sanitized.eventName,
    properties_json: JSON.stringify(sanitized.properties),
    session_id: sessionId,
    tracking_version: ANALYTICS_V1_TRACKING_VERSION,
  };
}

function parseTaipeiDate(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateKey, days) {
  const date = parseTaipeiDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(startDateKey, endDateKey) {
  return Math.floor(
    (parseTaipeiDate(endDateKey).getTime() - parseTaipeiDate(startDateKey).getTime()) /
      (24 * 60 * 60 * 1000),
  );
}

function createRetentionCell({ cohort, activeByDate, offset, nowDateKey }) {
  if (cohort.devices.length === 0) {
    return {
      mature: false,
      retainedDevices: 0,
      ratio: null,
    };
  }

  const matured = daysBetween(cohort.date, nowDateKey) >= offset;
  if (!matured) {
    return {
      mature: false,
      retainedDevices: 0,
      ratio: null,
    };
  }

  const activeDevices = new Set(activeByDate[addDays(cohort.date, offset)] || []);
  const retainedDevices = cohort.devices.filter((deviceId) => activeDevices.has(deviceId)).length;

  return {
    mature: true,
    retainedDevices,
    ratio: retainedDevices / cohort.devices.length,
  };
}

function createWeightedRetention(cohorts, key) {
  const matureCohorts = cohorts.filter(
    (cohort) => cohort.size > 0 && cohort.retention[key].mature,
  );
  if (matureCohorts.length === 0) {
    return null;
  }

  const matureDevices = matureCohorts.reduce((total, cohort) => total + cohort.size, 0);
  const retainedDevices = matureCohorts.reduce(
    (total, cohort) => total + cohort.retention[key].retainedDevices,
    0,
  );

  return {
    matureDevices,
    retainedDevices,
    ratio: matureDevices > 0 ? retainedDevices / matureDevices : 0,
  };
}

export function createAnalyticsRetentionSummary({ cohorts, activeByDate, now = new Date() }) {
  const nowDateKey = getTaipeiDateKey(now);
  const cohortRows = (cohorts || []).map((cohort) => {
    const devices = Array.from(new Set(cohort.devices || []));

    return {
      date: cohort.date,
      devices,
      size: devices.length,
      retention: {
        d1: createRetentionCell({
          cohort: { date: cohort.date, devices },
          activeByDate,
          offset: 1,
          nowDateKey,
        }),
        d7: createRetentionCell({
          cohort: { date: cohort.date, devices },
          activeByDate,
          offset: 7,
          nowDateKey,
        }),
        d30: createRetentionCell({
          cohort: { date: cohort.date, devices },
          activeByDate,
          offset: 30,
          nowDateKey,
        }),
      },
    };
  });

  return {
    cohorts: cohortRows,
    weighted: {
      d1: createWeightedRetention(cohortRows, "d1"),
      d7: createWeightedRetention(cohortRows, "d7"),
      d30: createWeightedRetention(cohortRows, "d30"),
    },
  };
}
