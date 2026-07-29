import {
  authorizeDynamicBetaRequest,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaRepository,
  requireDynamicBetaDataEnabled,
} from "../_shared.js";
import { createMarketRiskScorePreview } from "../../../../src/lib/dynamic-beta/score-preview.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function requestedDate(request) {
  const value = new URL(request.url).searchParams.get("date");
  if (!value) return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export async function GET(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const disabled = requireDynamicBetaDataEnabled();
  if (disabled) return disabled;

  const asOf = requestedDate(request);
  if (!asOf) {
    return Response.json({ error: "date 必須使用 YYYY-MM-DD。" }, { status: 400 });
  }
  const repository = getDynamicBetaRepository();
  if (!repository) {
    return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  }
  try {
    return Response.json(
      await createMarketRiskScorePreview({ repository, asOf }),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error
          ? error.message
          : "Market Risk Score preview 計算失敗。",
      },
      { status: 500 },
    );
  }
}
