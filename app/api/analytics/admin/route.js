import {
  getRedis,
  isAdminAuthorized,
  readAnalyticsAdminMetrics,
  unauthorizedResponse,
  unconfiguredResponse,
} from "../_shared.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  if (!isAdminAuthorized(request)) {
    return unauthorizedResponse();
  }

  const redis = getRedis();
  if (!redis) {
    return unconfiguredResponse();
  }

  try {
    return Response.json(await readAnalyticsAdminMetrics(redis));
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error ? error.message : "Analytics v1 讀取失敗。",
      },
      { status: 500 },
    );
  }
}
