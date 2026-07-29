import {
  NewsDraftConflictError,
  NewsDraftNotFoundError,
} from "../../../../../src/lib/dynamic-beta/news/draft-service.js";

function validDateKey(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validLimit(value) {
  if (value === null) return true;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= 50;
}

function readCollectionQuery(request) {
  const url = new URL(request.url);
  const briefDate = url.searchParams.get("briefDate");
  const draftRevisionId = url.searchParams.get("draftRevisionId");
  const rawLimit = url.searchParams.get("limit");
  if (!validDateKey(briefDate)) {
    return { error: "briefDate 必須使用有效的 YYYY-MM-DD。" };
  }
  if (draftRevisionId && !briefDate) {
    return { error: "draftRevisionId 必須搭配 briefDate。" };
  }
  if (!validLimit(rawLimit)) {
    return { error: "limit 必須介於 1 與 50。" };
  }
  return {
    value: {
      briefDate,
      draftRevisionId,
      limit: rawLimit === null ? undefined : Number(rawLimit),
    },
  };
}

async function readJson(request) {
  try {
    return { value: await request.json() };
  } catch {
    return { error: "JSON 格式無效。" };
  }
}

function protectedResponse({ authorize, requireEnabled }, request) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;
  return requireEnabled();
}

function withFlags(result, flags) {
  return {
    ...(Array.isArray(result) ? { drafts: result } : result),
    flags: flags(),
  };
}

function collectionErrorResponse(error, method) {
  console.error(`[dynamic-beta-news-draft:collection:${method}]`, error);
  return Response.json({ error: "晨報草稿處理失敗。" }, { status: 500 });
}

export function createDraftCollectionHandlers({
  authorize,
  requireEnabled,
  getService,
  flags,
  unconfigured,
}) {
  return {
    async GET(request) {
      const protectedResult = protectedResponse({ authorize, requireEnabled }, request);
      if (protectedResult) return protectedResult;

      const query = readCollectionQuery(request);
      if (query.error) return Response.json({ error: query.error }, { status: 400 });

      try {
        const service = getService();
        if (!service) return unconfigured("缺少 Upstash Redis 設定。");
        const result = await service.list(query.value);
        return Response.json(withFlags(result, flags));
      } catch (error) {
        return collectionErrorResponse(error, "get");
      }
    },

    async POST(request) {
      const protectedResult = protectedResponse({ authorize, requireEnabled }, request);
      if (protectedResult) return protectedResult;

      const parsed = await readJson(request);
      if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });

      try {
        const service = getService();
        if (!service) return unconfigured("缺少 Upstash Redis 設定。");
        const result = await service.create(parsed.value);
        return Response.json(withFlags(result, flags), {
          status: result?.saved === false ? 400 : 200,
        });
      } catch (error) {
        return collectionErrorResponse(error, "post");
      }
    },
  };
}

function exactActionInput(payload, action) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "briefDate 與 draftRevisionId 為必填欄位。" };
  }
  if (typeof payload.briefDate !== "string"
    || !payload.briefDate
    || !validDateKey(payload.briefDate)
    || typeof payload.draftRevisionId !== "string"
    || !payload.draftRevisionId) {
    return { error: "briefDate 與 draftRevisionId 必須完整且有效。" };
  }
  if (action === "reject" && payload.reason !== undefined && typeof payload.reason !== "string") {
    return { error: "reason 必須為字串。" };
  }
  return {
    value: action === "reject"
      ? {
        briefDate: payload.briefDate,
        draftRevisionId: payload.draftRevisionId,
        ...(payload.reason === undefined ? {} : { reason: payload.reason }),
      }
      : {
        briefDate: payload.briefDate,
        draftRevisionId: payload.draftRevisionId,
      },
  };
}

function unexpectedActionErrorResponse(error, action) {
  console.error(`[dynamic-beta-news-draft:${action}]`, error);
  return Response.json({ error: "晨報草稿處理失敗。" }, { status: 500 });
}

function lifecycleActionErrorResponse(error, action) {
  if (error instanceof NewsDraftNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof NewsDraftConflictError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return unexpectedActionErrorResponse(error, action);
}

export function createDraftActionHandlers({
  action,
  authorize,
  requireEnabled,
  getService,
  unconfigured,
}) {
  return {
    async POST(request) {
      const protectedResult = protectedResponse({ authorize, requireEnabled }, request);
      if (protectedResult) return protectedResult;

      const parsed = await readJson(request);
      if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
      const input = exactActionInput(parsed.value, action);
      if (input.error) return Response.json({ error: input.error }, { status: 400 });

      let service;
      try {
        service = getService();
        if (!service) return await unconfigured("缺少 Upstash Redis 設定。");
      } catch (error) {
        return unexpectedActionErrorResponse(error, action);
      }

      let result;
      try {
        result = await service[action](input.value);
      } catch (error) {
        return lifecycleActionErrorResponse(error, action);
      }

      try {
        return Response.json(result);
      } catch (error) {
        return unexpectedActionErrorResponse(error, action);
      }
    },
  };
}
