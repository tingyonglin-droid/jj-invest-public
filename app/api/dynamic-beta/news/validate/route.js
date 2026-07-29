import {
  authorizeDynamicBetaRequest,
  createConfiguredNewsEventService,
  getDynamicBetaNewsFlags,
  requireDynamicBetaNewsDataEnabled,
} from "../../_shared.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const unauthorized = authorizeDynamicBetaRequest(request);
  if (unauthorized) return unauthorized;
  const disabled = requireDynamicBetaNewsDataEnabled();
  if (disabled) return disabled;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "JSON 格式無效。" }, { status: 400 });
  }

  const result = await createConfiguredNewsEventService().validate(payload);
  return Response.json(
    { ...result, flags: getDynamicBetaNewsFlags() },
    { status: result.valid ? 200 : 400 },
  );
}
