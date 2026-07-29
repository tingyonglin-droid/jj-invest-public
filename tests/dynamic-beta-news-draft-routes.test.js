import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDraftActionHandlers,
  createDraftCollectionHandlers,
} from "../app/api/dynamic-beta/news/drafts/_handlers.js";
import {
  NewsDraftConflictError,
  NewsDraftNotFoundError,
} from "../src/lib/dynamic-beta/news/draft-service.js";

const enabledFlags = {
  dataEnabled: true,
  scoringEnabled: false,
  publicEnabled: false,
};

function request(path, options = {}) {
  return new Request(`https://example.com${path}`, options);
}

function collectionHandlers(overrides = {}) {
  return createDraftCollectionHandlers({
    authorize() { return null; },
    requireEnabled() { return null; },
    getService() {
      return {
        async list() { return { drafts: [] }; },
        async create() { return { saved: true, draft: { status: "pending" } }; },
      };
    },
    flags() { return enabledFlags; },
    unconfigured(message) {
      return Response.json({ configured: false, error: message }, { status: 503 });
    },
    ...overrides,
  });
}

function actionHandlers(action, service) {
  return createDraftActionHandlers({
    action,
    authorize() { return null; },
    requireEnabled() { return null; },
    getService() { return service; },
    unconfigured(message) {
      return Response.json({ configured: false, error: message }, { status: 503 });
    },
  });
}

async function captureConsoleErrors(task) {
  const originalConsoleError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try {
    return { value: await task(), calls };
  } finally {
    console.error = originalConsoleError;
  }
}

describe("dynamic beta news draft collection handlers", () => {
  it("short-circuits unauthenticated requests before checking the feature flag", async () => {
    let flagChecked = false;
    const handlers = collectionHandlers({
      authorize() { return Response.json({ error: "unauthorized" }, { status: 401 }); },
      requireEnabled() {
        flagChecked = true;
        return null;
      },
    });

    const response = await handlers.GET(request("/api/dynamic-beta/news/drafts"));

    assert.equal(response.status, 401);
    assert.equal(flagChecked, false);
  });

  it("short-circuits disabled news data before constructing a draft service", async () => {
    let serviceRequested = false;
    const handlers = collectionHandlers({
      requireEnabled() {
        return Response.json({ error: "disabled" }, { status: 404 });
      },
      getService() {
        serviceRequested = true;
        return null;
      },
    });

    const response = await handlers.GET(request("/api/dynamic-beta/news/drafts"));

    assert.equal(response.status, 404);
    assert.equal(serviceRequested, false);
  });

  it("rejects malformed draft JSON", async () => {
    const response = await collectionHandlers().POST(request("/api/dynamic-beta/news/drafts", {
      method: "POST",
      body: "{broken",
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "JSON 格式無效。" });
  });

  it("rejects impossible query dates before reading drafts", async () => {
    let listCalled = false;
    const handlers = collectionHandlers({
      getService() {
        return {
          async list() {
            listCalled = true;
            return { drafts: [] };
          },
        };
      },
    });

    const response = await handlers.GET(request(
      "/api/dynamic-beta/news/drafts?briefDate=2026-02-30",
    ));

    assert.equal(response.status, 400);
    assert.equal(listCalled, false);
  });

  it("requires a brief date when selecting a draft revision", async () => {
    const response = await collectionHandlers().GET(request(
      "/api/dynamic-beta/news/drafts?draftRevisionId=ndrv_example",
    ));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /draftRevisionId.*briefDate/);
  });

  it("rejects collection limits outside one through fifty", async () => {
    for (const limit of ["0", "51", "not-a-number"]) {
      const response = await collectionHandlers().GET(request(
        `/api/dynamic-beta/news/drafts?limit=${limit}`,
      ));
      assert.equal(response.status, 400);
    }
  });

  it("returns draft reads and writes with disabled scoring and public flags intact", async () => {
    const handlers = collectionHandlers({
      getService() {
        return {
          async list(input) {
            assert.deepEqual(input, {
              briefDate: "2026-07-28",
              draftRevisionId: "ndrv_example",
              limit: 12,
            });
            return { drafts: [{ status: "pending" }] };
          },
          async create(payload) {
            assert.deepEqual(payload, { briefDate: "2026-07-28" });
            return { saved: true, draft: { status: "pending" } };
          },
        };
      },
    });

    const getResponse = await handlers.GET(request(
      "/api/dynamic-beta/news/drafts?briefDate=2026-07-28&draftRevisionId=ndrv_example&limit=12",
    ));
    const postResponse = await handlers.POST(request("/api/dynamic-beta/news/drafts", {
      method: "POST",
      body: JSON.stringify({ briefDate: "2026-07-28" }),
      headers: { "Content-Type": "application/json" },
    }));

    assert.deepEqual(await getResponse.json(), {
      drafts: [{ status: "pending" }],
      flags: enabledFlags,
    });
    assert.deepEqual(await postResponse.json(), {
      saved: true,
      draft: { status: "pending" },
      flags: enabledFlags,
    });
  });

  it("returns invalid draft schema results as bad requests", async () => {
    const handlers = collectionHandlers({
      getService() {
        return {
          async create() {
            return { saved: false, valid: false, errors: ["events 必須剛好包含 5 個事件。"] };
          },
        };
      },
    });

    const response = await handlers.POST(request("/api/dynamic-beta/news/drafts", {
      method: "POST",
      body: JSON.stringify({ events: [] }),
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(response.status, 400);
    assert.deepEqual((await response.json()).errors, ["events 必須剛好包含 5 個事件。"]);
  });

  it("sanitizes secret-bearing GET construction and list failures with a route-scoped log", async () => {
    for (const mode of ["construction", "list"]) {
      const secret = `get-${mode}-secret`;
      const handlers = collectionHandlers({
        getService() {
          if (mode === "construction") throw new Error(secret);
          return {
            async list() { throw new Error(secret); },
          };
        },
      });
      const { value: response, calls } = await captureConsoleErrors(() => handlers.GET(
        request("/api/dynamic-beta/news/drafts"),
      ));
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
      assert.equal(JSON.stringify(payload).includes(secret), false);
      assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:collection:get]");
    }
  });

  it("sanitizes secret-bearing POST construction and create failures with a route-scoped log", async () => {
    for (const mode of ["construction", "create"]) {
      const secret = `post-${mode}-secret`;
      const handlers = collectionHandlers({
        getService() {
          if (mode === "construction") throw new Error(secret);
          return {
            async create() { throw new Error(secret); },
          };
        },
      });
      const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
        "/api/dynamic-beta/news/drafts",
        {
          method: "POST",
          body: JSON.stringify({ briefDate: "2026-07-28" }),
          headers: { "Content-Type": "application/json" },
        },
      )));
      const payload = await response.json();

      assert.equal(response.status, 500);
      assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
      assert.equal(JSON.stringify(payload).includes(secret), false);
      assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:collection:post]");
    }
  });
});

describe("dynamic beta news draft action handlers", () => {
  it("rejects approval without a brief date before calling the service", async () => {
    let approveCalled = false;
    const handlers = actionHandlers("approve", {
      async approve() {
        approveCalled = true;
        return { draft: { status: "approved" } };
      },
    });

    const response = await handlers.POST(request("/api/dynamic-beta/news/drafts/approve", {
      method: "POST",
      body: JSON.stringify({ draftRevisionId: "ndrv_example" }),
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(response.status, 400);
    assert.equal(approveCalled, false);
  });

  it("rejects rejection without a brief date before calling the service", async () => {
    let rejectCalled = false;
    const handlers = actionHandlers("reject", {
      async reject() {
        rejectCalled = true;
        return { draft: { status: "rejected" } };
      },
    });

    const response = await handlers.POST(request("/api/dynamic-beta/news/drafts/reject", {
      method: "POST",
      body: JSON.stringify({ draftRevisionId: "ndrv_example" }),
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(response.status, 400);
    assert.equal(rejectCalled, false);
  });

  it("requires an exact draft revision for approvals and rejections", async () => {
    for (const action of ["approve", "reject"]) {
      const handlers = actionHandlers(action, { async [action]() {} });
      const response = await handlers.POST(request(`/api/dynamic-beta/news/drafts/${action}`, {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28" }),
        headers: { "Content-Type": "application/json" },
      }));

      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /briefDate.*draftRevisionId/);
    }
  });

  it("passes the optional string rejection reason to the exact rejection lifecycle method", async () => {
    const handlers = actionHandlers("reject", {
      async reject(input) {
        assert.deepEqual(input, {
          briefDate: "2026-07-28",
          draftRevisionId: "ndrv_example",
          reason: "Needs more sources.",
        });
        return { draft: { status: "rejected" } };
      },
    });

    const response = await handlers.POST(request("/api/dynamic-beta/news/drafts/reject", {
      method: "POST",
      body: JSON.stringify({
        briefDate: "2026-07-28",
        draftRevisionId: "ndrv_example",
        reason: "Needs more sources.",
      }),
      headers: { "Content-Type": "application/json" },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { draft: { status: "rejected" } });
  });

  it("maps missing drafts and incompatible lifecycle states", async () => {
    const input = JSON.stringify({
      briefDate: "2026-07-28",
      draftRevisionId: "ndrv_example",
    });
    const missing = actionHandlers("approve", {
      async approve() { throw new NewsDraftNotFoundError("找不到草稿。"); },
    });
    const conflict = actionHandlers("reject", {
      async reject() { throw new NewsDraftConflictError("只有待審核草稿可以駁回。"); },
    });

    const missingResponse = await missing.POST(request("/api/dynamic-beta/news/drafts/approve", {
      method: "POST", body: input, headers: { "Content-Type": "application/json" },
    }));
    const conflictResponse = await conflict.POST(request("/api/dynamic-beta/news/drafts/reject", {
      method: "POST", body: input, headers: { "Content-Type": "application/json" },
    }));

    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), { error: "找不到草稿。" });
    assert.equal(conflictResponse.status, 409);
    assert.deepEqual(await conflictResponse.json(), { error: "只有待審核草稿可以駁回。" });
  });

  // Mutation caught: constructing the approval service before entering sanitized error handling.
  it("sanitizes secret-bearing approval service-construction failures", async () => {
    const secret = "approve-constructor-secret";
    const handlers = createDraftActionHandlers({
      action: "approve",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { throw new Error(secret); },
      unconfigured() { throw new Error("must not run"); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: constructing the rejection service before entering sanitized error handling.
  it("sanitizes secret-bearing rejection service-construction failures", async () => {
    const secret = "reject-constructor-secret";
    const handlers = createDraftActionHandlers({
      action: "reject",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { throw new Error(secret); },
      unconfigured() { throw new Error("must not run"); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: classifying an approval getService domain-shaped error as a lifecycle conflict.
  it("sanitizes domain-typed approval service-construction failures by stage", async () => {
    const secret = "approve-domain-constructor-secret";
    const handlers = createDraftActionHandlers({
      action: "approve",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { throw new NewsDraftConflictError(secret); },
      unconfigured() { throw new Error("must not run"); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: classifying a rejection getService domain-shaped error as a missing draft.
  it("sanitizes domain-typed rejection service-construction failures by stage", async () => {
    const secret = "reject-domain-constructor-secret";
    const handlers = createDraftActionHandlers({
      action: "reject",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { throw new NewsDraftNotFoundError(secret); },
      unconfigured() { throw new Error("must not run"); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: constructing an approval unconfigured response outside sanitized handling.
  it("sanitizes secret-bearing approval unconfigured-response failures", async () => {
    const secret = "approve-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "approve",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      unconfigured() { throw new Error(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
  });

  // Mutation caught: constructing a rejection unconfigured response outside sanitized handling.
  it("sanitizes secret-bearing rejection unconfigured-response failures", async () => {
    const secret = "reject-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "reject",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      unconfigured() { throw new Error(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
  });

  // Mutation caught: classifying an approval unconfigured domain-shaped error as a lifecycle conflict.
  it("sanitizes domain-typed approval unconfigured-response failures by stage", async () => {
    const secret = "approve-domain-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "approve",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      unconfigured() { throw new NewsDraftConflictError(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: classifying a rejection unconfigured domain-shaped error as a missing draft.
  it("sanitizes domain-typed rejection unconfigured-response failures by stage", async () => {
    const secret = "reject-domain-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "reject",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      unconfigured() { throw new NewsDraftNotFoundError(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: returning an approval unconfigured Promise without awaiting its domain rejection.
  it("sanitizes asynchronous domain-typed approval unconfigured failures", async () => {
    const secret = "approve-async-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "approve",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      async unconfigured() { throw new NewsDraftConflictError(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: returning a rejection unconfigured Promise without awaiting its domain rejection.
  it("sanitizes asynchronous domain-typed rejection unconfigured failures", async () => {
    const secret = "reject-async-unconfigured-secret";
    const handlers = createDraftActionHandlers({
      action: "reject",
      authorize() { return null; },
      requireEnabled() { return null; },
      getService() { return null; },
      async unconfigured() { throw new NewsDraftNotFoundError(secret); },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: mapping a domain-typed approval serialization failure as a lifecycle conflict.
  it("sanitizes approval response serialization failures by stage", async () => {
    const secret = "approve-serialization-secret";
    const handlers = actionHandlers("approve", {
      async approve() {
        return {
          toJSON() { throw new NewsDraftConflictError(secret); },
        };
      },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/approve",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:approve]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  // Mutation caught: mapping a domain-typed rejection serialization failure as a missing draft.
  it("sanitizes rejection response serialization failures by stage", async () => {
    const secret = "reject-serialization-secret";
    const handlers = actionHandlers("reject", {
      async reject() {
        return {
          toJSON() { throw new NewsDraftNotFoundError(secret); },
        };
      },
    });
    const { value: response, calls } = await captureConsoleErrors(() => handlers.POST(request(
      "/api/dynamic-beta/news/drafts/reject",
      {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      },
    )));
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(calls[0]?.[0], "[dynamic-beta-news-draft:reject]");
    assert.equal(calls[0]?.[1]?.message, secret);
  });

  it("sanitizes unexpected draft action failures", async () => {
    const handlers = actionHandlers("approve", {
      async approve() { throw new Error("fake-secret-value"); },
    });

    const originalConsoleError = console.error;
    console.error = () => {};
    let response;
    try {
      response = await handlers.POST(request("/api/dynamic-beta/news/drafts/approve", {
        method: "POST",
        body: JSON.stringify({ briefDate: "2026-07-28", draftRevisionId: "ndrv_example" }),
        headers: { "Content-Type": "application/json" },
      }));
    } finally {
      console.error = originalConsoleError;
    }
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(payload, { error: "晨報草稿處理失敗。" });
    assert.equal(JSON.stringify(payload).includes("fake-secret-value"), false);
  });
});
