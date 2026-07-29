import {
  authorizeDynamicBetaRequest,
  createConfiguredNewsMarketConfirmationService,
  dynamicBetaUnconfiguredResponse,
  requireDynamicBetaDataEnabled,
  requireDynamicBetaNewsDataEnabled,
} from "../../_shared.js";

export const dynamic = "force-dynamic";

function validDateKey(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const marketDisabled = requireDynamicBetaDataEnabled();
  if (marketDisabled) return marketDisabled;
  const newsDisabled = requireDynamicBetaNewsDataEnabled();
  if (newsDisabled) return newsDisabled;

  const url = new URL(request.url);
  const briefDate = url.searchParams.get("briefDate");
  const revisionId = url.searchParams.get("revisionId");
  const asOf = url.searchParams.get("asOf");
  if (!validDateKey(briefDate) || !validDateKey(asOf)) {
    return Response.json(
      { error: "briefDate 與 asOf 必須使用有效的 YYYY-MM-DD。" },
      { status: 400 },
    );
  }
  if (revisionId && !briefDate) {
    return Response.json(
      { error: "revisionId 必須搭配 briefDate。" },
      { status: 400 },
    );
  }

  const service = createConfiguredNewsMarketConfirmationService();
  if (!service) return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  try {
    return Response.json(await service.evaluate({ briefDate, revisionId, asOf }));
  } catch (error) {
    if (error?.code === "INVALID_DATE" || error?.code === "INVALID_QUERY") {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error?.code === "MISSING_BRIEF") {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error?.code === "UNCONFIGURED_REPOSITORY") {
      return dynamicBetaUnconfiguredResponse(error.message);
    }
    console.error("News market confirmation failed", error);
    return Response.json(
      { error: "News market confirmation 讀取失敗。" },
      { status: 500 },
    );
  }
}
