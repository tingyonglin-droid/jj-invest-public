import {
  authorizeDynamicBetaRequest,
  createConfiguredNewsEventService,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaNewsFlags,
  getDynamicBetaNewsRepository,
  requireDynamicBetaNewsDataEnabled,
} from "../_shared.js";

export const dynamic = "force-dynamic";

async function readJson(request) {
  try {
    return { value: await request.json(), error: null };
  } catch {
    return { value: null, error: "JSON 格式無效。" };
  }
}

export async function GET(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const disabled = requireDynamicBetaNewsDataEnabled();
  if (disabled) return disabled;

  const repository = getDynamicBetaNewsRepository();
  if (!repository) {
    return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  }
  try {
    const [briefs, evidence] = await Promise.all([
      repository.readRecentBriefs({ limit: 20 }),
      repository.readEvidenceSummaries({ limit: 50 }),
    ]);
    return Response.json({
      configured: true,
      flags: getDynamicBetaNewsFlags(),
      briefs,
      evidence,
    });
  } catch (error) {
    return Response.json(
      {
        configured: true,
        error: error instanceof Error
          ? error.message
          : "News Event data 讀取失敗。",
      },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const disabled = requireDynamicBetaNewsDataEnabled();
  if (disabled) return disabled;

  const parsed = await readJson(request);
  if (parsed.error) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const validation = await createConfiguredNewsEventService().validate(parsed.value);
  if (!validation.valid) {
    return Response.json(
      {
        saved: false,
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
      },
      { status: 400 },
    );
  }

  const repository = getDynamicBetaNewsRepository();
  if (!repository) {
    return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
  }
  try {
    return Response.json(await createConfiguredNewsEventService(repository).ingest(parsed.value));
  } catch (error) {
    return Response.json(
      {
        saved: false,
        error: error instanceof Error ? error.message : "News Event data 寫入失敗。",
      },
      { status: 500 },
    );
  }
}
