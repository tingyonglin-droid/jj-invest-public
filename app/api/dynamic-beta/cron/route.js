import {
  createConfiguredSyncService,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaRepository,
  requireDynamicBetaDataEnabled,
} from "../_shared.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "未授權的 Dynamic Beta cron。" }, { status: 401 });
  }
  return null;
}

export async function GET(request) {
  const unauthorized = authorizeCron(request);
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

  try {
    return Response.json(await createConfiguredSyncService(repository).sync());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Dynamic Beta cron 同步失敗。";
    return Response.json(
      { error: message },
      { status: message.includes("已在執行中") ? 409 : 500 },
    );
  }
}
