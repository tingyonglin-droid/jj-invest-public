import {
  authorizeDynamicBetaRequest,
  DYNAMIC_BETA_SERIES,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaFlags,
  getDynamicBetaRepository,
  requireDynamicBetaDataEnabled,
} from "../_shared.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
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

  try {
    return Response.json({
      configured: true,
      enabled: true,
      flags: getDynamicBetaFlags(),
      series: await repository.readDashboard(DYNAMIC_BETA_SERIES),
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error:
          error instanceof Error
            ? error.message
            : "Dynamic Beta data validation 讀取失敗。",
      },
      { status: 500 },
    );
  }
}
