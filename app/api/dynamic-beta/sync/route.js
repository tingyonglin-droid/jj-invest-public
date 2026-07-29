import {
  authorizeDynamicBetaRequest,
  createConfiguredSyncService,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaRepository,
  requireDynamicBetaDataEnabled,
} from "../_shared.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseSeriesIds(payload) {
  if (Array.isArray(payload?.seriesIds)) {
    return payload.seriesIds.map(String);
  }
  if (payload?.seriesId) {
    return [String(payload.seriesId)];
  }
  return undefined;
}

export async function POST(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) {
    return unauthorized;
  }
  const disabled = requireDynamicBetaDataEnabled();
  if (disabled) {
    return disabled;
  }

  const repository = getDynamicBetaRepository();
  if (!repository) {
    return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  }
  if (!String(process.env.FRED_API_KEY || "").trim()) {
    return dynamicBetaUnconfiguredResponse("缺少 server-side FRED_API_KEY。");
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  try {
    const service = createConfiguredSyncService(repository);
    return Response.json(
      await service.sync({ seriesIds: parseSeriesIds(payload) }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dynamic Beta 資料同步失敗。";
    const status = message.includes("已在執行中")
      ? 409
      : message.includes("不支援的 Dynamic Beta series")
        ? 400
        : 500;
    return Response.json({ error: message }, { status });
  }
}
