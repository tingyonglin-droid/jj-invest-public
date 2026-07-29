import { getRedis, isAdminAuthorized } from "../analytics/_shared.js";
import {
  DYNAMIC_BETA_SERIES,
  getDynamicBetaSeries,
} from "../../../src/lib/dynamic-beta/catalog.js";
import {
  getDynamicBetaFlags,
  getDynamicBetaNewsFlags,
} from "../../../src/lib/dynamic-beta/config.js";
import { createFredClient } from "../../../src/lib/dynamic-beta/fred-client.js";
import { MACROMICRO_MARGIN_SERIES_ID } from "../../../src/lib/dynamic-beta/macromicro.js";
import { createMacroMicroIngestionService } from "../../../src/lib/dynamic-beta/macromicro-service.js";
import { createDynamicBetaRepository } from "../../../src/lib/dynamic-beta/repository.js";
import { createDynamicBetaSyncService } from "../../../src/lib/dynamic-beta/sync.js";
import { createNewsRepository } from "../../../src/lib/dynamic-beta/news/repository.js";
import { createNewsDraftRepository } from "../../../src/lib/dynamic-beta/news/draft-repository.js";
import { createNewsMarketConfirmationService } from "../../../src/lib/dynamic-beta/news/confirmation-service.js";
import { createNewsEventService } from "../../../src/lib/dynamic-beta/news/service.js";
import { createNewsDraftService } from "../../../src/lib/dynamic-beta/news/draft-service.js";

export function authorizeDynamicBetaRequest(request) {
  if (!isAdminAuthorized(request)) {
    return Response.json(
      { error: "未授權存取 Dynamic Beta data module。" },
      { status: 401 },
    );
  }
  return null;
}

export function requireDynamicBetaDataEnabled() {
  if (!getDynamicBetaFlags().dataEnabled) {
    return Response.json(
      {
        enabled: false,
        error: "Dynamic Beta data module 未啟用。",
      },
      { status: 404 },
    );
  }
  return null;
}

export function requireDynamicBetaNewsDataEnabled() {
  if (!getDynamicBetaNewsFlags().dataEnabled) {
    return Response.json(
      {
        enabled: false,
        error: "Dynamic Beta News Event data module 未啟用。",
      },
      { status: 404 },
    );
  }
  return null;
}

export function getDynamicBetaRepository() {
  const redis = getRedis();
  return redis ? createDynamicBetaRepository(redis) : null;
}

export function getDynamicBetaNewsRepository() {
  const redis = getRedis();
  return redis ? createNewsRepository(redis) : null;
}

export function getDynamicBetaNewsDraftRepository() {
  const redis = getRedis();
  return redis ? createNewsDraftRepository(redis) : null;
}

export function createConfiguredNewsEventService(repository = null) {
  return createNewsEventService({ repository });
}

export function createConfiguredNewsDraftService({
  draftRepository = getDynamicBetaNewsDraftRepository(),
  newsRepository = getDynamicBetaNewsRepository(),
} = {}) {
  if (!draftRepository || !newsRepository) return null;
  return createNewsDraftService({
    draftRepository,
    newsEventService: createConfiguredNewsEventService(newsRepository),
  });
}

export function createConfiguredNewsMarketConfirmationService({
  newsRepository = getDynamicBetaNewsRepository(),
  marketRepository = getDynamicBetaRepository(),
} = {}) {
  if (!newsRepository || !marketRepository) return null;
  return createNewsMarketConfirmationService({ newsRepository, marketRepository });
}

export function createConfiguredSyncService(repository) {
  return createDynamicBetaSyncService({
    repository,
    fredClient: createFredClient({ apiKey: process.env.FRED_API_KEY }),
  });
}

export function createConfiguredMacroMicroIngestionService(
  repository = getDynamicBetaRepository(),
) {
  if (!repository) return null;
  return createMacroMicroIngestionService({
    repository,
    series: getDynamicBetaSeries(MACROMICRO_MARGIN_SERIES_ID),
  });
}

export function dynamicBetaUnconfiguredResponse(message) {
  return Response.json(
    {
      configured: false,
      error: message,
    },
    { status: 503 },
  );
}

export { DYNAMIC_BETA_SERIES, getDynamicBetaFlags, getDynamicBetaNewsFlags };
