import {
  authorizeDynamicBetaRequest,
  createConfiguredNewsDraftService,
  dynamicBetaUnconfiguredResponse,
  requireDynamicBetaNewsDataEnabled,
} from "../../../_shared.js";
import { createDraftActionHandlers } from "../_handlers.js";

export const dynamic = "force-dynamic";

const handlers = createDraftActionHandlers({
  action: "approve",
  authorize: authorizeDynamicBetaRequest,
  requireEnabled: requireDynamicBetaNewsDataEnabled,
  getService: createConfiguredNewsDraftService,
  unconfigured: dynamicBetaUnconfiguredResponse,
});

export const { POST } = handlers;
