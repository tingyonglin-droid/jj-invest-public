const TAIPEI_TIME_ZONE = "Asia/Taipei";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TAIPEI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function sanitizeDeviceId(value) {
  const deviceId = String(value || "").trim();
  return DEVICE_ID_PATTERN.test(deviceId) ? deviceId : "";
}

export function isUsageAdminAuthorized(requestUrl, expectedToken) {
  const token = String(expectedToken || "").trim();
  if (!token) {
    return false;
  }

  try {
    const url = new URL(requestUrl);
    return url.searchParams.get("token") === token;
  } catch {
    return false;
  }
}

export function getTaipeiDateKey(date = new Date()) {
  return taipeiDateFormatter.format(date);
}

export function getTaipeiDateKeys(days, now = new Date()) {
  const safeDays = Math.max(0, Math.floor(Number(days) || 0));

  return Array.from({ length: safeDays }, (_, index) => {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - index);
    return getTaipeiDateKey(date);
  });
}

export function uniqueCount(values) {
  return new Set((values || []).filter(Boolean)).size;
}

export function createUsageMetrics({
  totalDevices,
  totalOpens,
  todayDevices,
  sevenDayDevices,
  thirtyDayDevices,
  opensToday,
}) {
  return {
    configured: true,
    totalDevices: Number(totalDevices) || 0,
    totalOpens: Number(totalOpens) || 0,
    activeToday: uniqueCount(todayDevices),
    active7Days: uniqueCount(sevenDayDevices),
    active30Days: uniqueCount(thirtyDayDevices),
    opensToday: Number(opensToday) || 0,
  };
}
