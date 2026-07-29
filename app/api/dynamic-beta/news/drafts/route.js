import {
  authorizeDynamicBetaRequest,
  createConfiguredNewsDraftService,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaNewsFlags,
  requireDynamicBetaNewsDataEnabled,
} from "../../_shared.js";
import { createDraftCollectionHandlers } from "./_handlers.js";

export const dynamic = "force-dynamic";

const handlers = createDraftCollectionHandlers({
  authorize: authorizeDynamicBetaRequest,
  requireEnabled: requireDynamicBetaNewsDataEnabled,
  getService: createConfiguredNewsDraftService,
  flags: getDynamicBetaNewsFlags,
  unconfigured: dynamicBetaUnconfiguredResponse,
});

export const { GET, POST } = handlers;
