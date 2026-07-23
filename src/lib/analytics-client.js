import {
  createSessionState,
  getAnalyticsAppVersion,
  getHoldingCountBucket,
  sanitizeAnalyticsEventPayload,
} from "./analytics-v1.js";

const DEVICE_STORAGE_KEY = "jj-invest-public-device-id-v1";
const SESSION_STORAGE_KEY = "jj-invest-public-analytics-session-v1";

function defaultCreateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function readJson(storage, key) {
  try {
    const value = storage?.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked by browser privacy settings.
  }
}

function getOrCreateDeviceId(storage, createId) {
  try {
    const saved = storage?.getItem(DEVICE_STORAGE_KEY);
    if (saved) {
      return saved;
    }

    const deviceId = createId();
    storage?.setItem(DEVICE_STORAGE_KEY, deviceId);
    return deviceId;
  } catch {
    return "";
  }
}

export function getMarketFromTicker(ticker) {
  const text = String(ticker || "").trim().toUpperCase();
  if (!text) {
    return "unknown";
  }
  if (/^\d{4,6}[A-Z]?$/.test(text) || text.endsWith(".TW")) {
    return "TW";
  }
  return "US";
}

export function getAssetType(assetBeta) {
  if (Number(assetBeta) === 2) {
    return "leveraged";
  }
  if (Number(assetBeta) === 1) {
    return "original";
  }
  return "unknown";
}

export function getResultStatus(calculation) {
  if (!calculation?.isValid) {
    return "invalid";
  }
  return calculation.needsRebalance ? "rebalance_needed" : "within_tolerance";
}

export function createAnalyticsClient({
  appVersion,
  fetcher,
  localStorage,
  sessionStorage,
  createId = defaultCreateId,
  now = () => new Date(),
} = {}) {
  const safeFetch = fetcher || globalThis.fetch?.bind(globalThis);
  const safeLocalStorage =
    localStorage || (typeof window !== "undefined" ? window.localStorage : null);
  const safeSessionStorage =
    sessionStorage || (typeof window !== "undefined" ? window.sessionStorage : null);
  const safeAppVersion = getAnalyticsAppVersion(appVersion);

  async function send(url, payload) {
    if (!safeFetch) {
      return null;
    }

    try {
      const response = await safeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      return response?.ok ? response : null;
    } catch {
      return null;
    }
  }

  async function startOrResumeSession() {
    const anonymousId = getOrCreateDeviceId(safeLocalStorage, createId);
    if (!anonymousId) {
      return null;
    }

    const session = createSessionState({
      currentSession: readJson(safeSessionStorage, SESSION_STORAGE_KEY),
      now: now(),
      appVersion: safeAppVersion,
      createId,
    });

    writeJson(safeSessionStorage, SESSION_STORAGE_KEY, {
      sessionId: session.sessionId,
      lastActivityAt: session.lastActivityAt,
    });

    await send("/api/analytics/session", {
      anonymousId,
      appVersion: session.appVersion,
      lastActivityAt: session.lastActivityAt,
      sessionId: session.sessionId,
      trackingVersion: session.trackingVersion,
    });

    return {
      anonymousId,
      sessionId: session.sessionId,
    };
  }

  async function trackEvent(eventName, properties = {}) {
    const session = await startOrResumeSession();
    if (!session) {
      return;
    }

    const payload = sanitizeAnalyticsEventPayload({ eventName, properties });
    if (!payload) {
      return;
    }

    await send("/api/analytics/event", {
      anonymousId: session.anonymousId,
      appVersion: safeAppVersion,
      eventId: createId(),
      eventName: payload.eventName,
      properties: payload.properties,
      sessionId: session.sessionId,
    });
  }

  return {
    startOrResumeSession,
    trackEvent,
    trackBetaCalculated({ holdingCount, resultStatus }) {
      return trackEvent("beta_calculated", {
        holding_count_bucket: getHoldingCountBucket(holdingCount),
        result_status: resultStatus,
      });
    },
    trackHoldingAdded({ assetType, market }) {
      return trackEvent("holding_added", {
        asset_type: assetType,
        market,
      });
    },
    trackHoldingDeleted({ assetType, market }) {
      return trackEvent("holding_deleted", {
        asset_type: assetType,
        market,
      });
    },
  };
}
