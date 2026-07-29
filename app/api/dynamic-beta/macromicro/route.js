import {
  authorizeDynamicBetaRequest,
  createConfiguredMacroMicroIngestionService,
  dynamicBetaUnconfiguredResponse,
  requireDynamicBetaDataEnabled,
} from "../_shared.js";
import { MacroMicroPayloadError } from "../../../../src/lib/dynamic-beta/macromicro.js";

export const dynamic = "force-dynamic";

const LOCK_ERROR = "Dynamic Beta 資料同步已在執行中。";

export function createMacroMicroPost({
  getService = createConfiguredMacroMicroIngestionService,
} = {}) {
  return async function postMacroMicro(request) {
    const unauthorized = authorizeDynamicBetaRequest(request);
    if (unauthorized) return unauthorized;
    const disabled = requireDynamicBetaDataEnabled();
    if (disabled) return disabled;

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "JSON 格式無效。" }, { status: 400 });
    }

    const service = getService();
    if (!service) {
      return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
    }

    try {
      return Response.json(await service.ingest(payload));
    } catch (error) {
      if (error instanceof MacroMicroPayloadError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Error && error.message === LOCK_ERROR) {
        return Response.json({ error: LOCK_ERROR }, { status: 409 });
      }
      return Response.json({ error: "MacroMicro 資料寫入失敗。" }, { status: 500 });
    }
  };
}

export const POST = createMacroMicroPost();
