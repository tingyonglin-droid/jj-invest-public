import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import {
  buildDraftPreview,
  createDraftPanelController,
  draftActionState,
  draftPanelReducer,
  INITIAL_DRAFT_PANEL_STATE,
} from "../src/lib/dynamic-beta/news/draft-panel-controller.js";
import {
  approvalFailureMessage,
  draftStatusLabel,
  formatDraftRule,
} from "../src/lib/dynamic-beta/news/draft-view.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function loadDraftPanelComponent() {
  const componentUrl = new URL(
    "../app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js",
    import.meta.url,
  );
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const jsxRuntimeUrl = new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href;
  const controllerUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-panel-controller.js",
    import.meta.url,
  ).href;
  const adminHttpUrl = new URL(
    "../src/lib/dynamic-beta/admin-http.js",
    import.meta.url,
  ).href;
  const accessHookUrl = new URL(
    "../app/admin/dynamic-beta/useAdminAccessLifecycle.js",
    import.meta.url,
  ).href;
  const viewUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-view.js",
    import.meta.url,
  ).href;
  const morningBriefComponentUrl = new URL(
    "../src/components/morning-brief/MorningBriefContent.js",
    import.meta.url,
  );
  const presenterUrl = new URL(
    "../src/lib/dynamic-beta/news/brief-presentation.js",
    import.meta.url,
  ).href;
  const morningBriefSource = (await readFile(morningBriefComponentUrl, "utf8"))
    .replace(
      'from "../../lib/dynamic-beta/news/brief-presentation.js";',
      `from "${presenterUrl}";`,
    );
  const morningBriefTransformed = transformSync(morningBriefSource, {
    filename: morningBriefComponentUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  const morningBriefModuleUrl = `data:text/javascript;base64,${Buffer.from(morningBriefTransformed).toString("base64")}`;
  const source = (await readFile(componentUrl, "utf8"))
    .replace('from "react";', `from "${reactUrl}";`)
    .replace(
      'from "../../../src/lib/dynamic-beta/news/draft-panel-controller.js";',
      `from "${controllerUrl}";`,
    )
    .replace(
      'from "../../../src/lib/dynamic-beta/news/draft-view.js";',
      `from "${viewUrl}";`,
    )
    .replace(
      'from "../../../src/components/morning-brief/MorningBriefContent.js";',
      `from "${morningBriefModuleUrl}";`,
    )
    .replace(
      'from "../../../src/lib/dynamic-beta/admin-http.js";',
      `from "${adminHttpUrl}";`,
    )
    .replace(
      'from "./useAdminAccessLifecycle.js";',
      `from "${accessHookUrl}";`,
    );
  const transformed = transformSync(source, {
    filename: componentUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
  return (await import(moduleUrl)).default;
}

function renderedText(renderer) {
  function visit(node) {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(visit).join(" ");
    return node?.children?.map(visit).join(" ") || "";
  }
  return visit(renderer.toJSON()).replace(/\s+/g, " ").trim();
}

function buttonByText(renderer, text) {
  return renderer.root.findAllByType("button").find((button) => (
    button.children.map(String).join("").includes(text)
  ));
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function draftFixture({
  draftRevisionId = "ndrv_pending",
  draftRevisionNumber = 2,
  status = "pending",
  rejectionReason = status === "rejected" ? "Need another source." : null,
  approvedAt = status === "approved" ? "2026-07-28T00:20:00.000Z" : null,
  rejectedAt = status === "rejected" ? "2026-07-28T00:20:00.000Z" : null,
} = {}) {
  return {
    draftId: "2026-07-28",
    draftRevisionId,
    draftRevisionNumber,
    briefDate: "2026-07-28",
    status,
    createdAt: "2026-07-28T00:10:00.000Z",
    updatedAt: "2026-07-28T00:20:00.000Z",
    approvedAt,
    rejectedAt,
    rejectionReason,
    approvedBriefRevisionId: status === "approved" ? "nbr_approved" : null,
    approvedBriefRevisionNumber: status === "approved" ? 3 : null,
    validationWarnings: ["Review timestamp."],
    dedupeWarnings: [{
      evidenceId: "ev_source",
      possibleDuplicateOfEvidenceId: "ev_other",
      similarity: 0.9,
    }],
    payload: {
      generatedAt: "2026-07-28T00:00:00.000Z",
      analystLabel: "risk_elevated",
      analystRationale: "Waiting for confirmation.",
      evidence: [{
        evidenceId: "ev_source",
        canonicalUrl: "https://example.com/source",
        title: "Primary source",
        summary: "Source summary.",
        sourceName: "Example Source",
        sourceTier: "primary",
        publishedAt: "2026-07-27T23:00:00.000Z",
        retrievedAt: "2026-07-28T00:00:00.000Z",
      }],
      events: Array.from({ length: 5 }, (_, index) => ({
        rank: index + 1,
        headline: `Event ${index + 1}`,
        summary: `Summary ${index + 1}`,
        evidenceUrls: ["https://example.com/source"],
        topicIds: ["global_macro_fed"],
        transmissionPath: ["event", "market", "asset"],
        affectedAssets: ["SPY"],
        marketDate: "2026-07-28",
        dataToConfirm: ["YAHOO:SPY"],
        confirmationRules: [{
          seriesId: "YAHOO:SPY",
          expectedDirection: "down",
          changeType: "percent",
          threshold: 1,
        }],
        interpretation: "Waiting for market data.",
        confidence: 0.7,
        techEarnings: index === 0
          ? {
            company: "Example Cloud",
            revenueGrowthPct: 12.5,
            aiCloudGrowthPct: null,
            capexGrowthPct: 40,
            freeCashFlowGrowthPct: 5,
            capexGrowingFasterThanFcf: true,
          }
          : null,
      })),
    },
  };
}

describe("dynamic beta news draft admin UI", () => {
  it("translates draft state and confirmation rules without changing thresholds", () => {
    assert.equal(draftStatusLabel("pending"), "待核准");
    assert.equal(draftStatusLabel("approved"), "已核准");
    assert.equal(draftStatusLabel("rejected"), "已拒絕");
    assert.equal(formatDraftRule({
      seriesId: "YAHOO:QQQ",
      expectedDirection: "down",
      changeType: "percent",
      threshold: 1,
    }), "YAHOO:QQQ · 下跌至少 1%");
  });

  it("surfaces unsuccessful approval payloads even when the request succeeded", () => {
    assert.equal(
      approvalFailureMessage({ saved: false, error: "發布前驗證失敗。" }),
      "發布前驗證失敗。",
    );
    assert.equal(
      approvalFailureMessage({ saved: false, errors: ["來源已失效。", "資料不完整。"] }),
      "來源已失效。 資料不完整。",
    );
    assert.equal(
      approvalFailureMessage({ saved: false }),
      "晨報草稿無法發布。",
    );
    assert.equal(approvalFailureMessage({ saved: true }), "");
  });

  it("retains a selected revision across reloads and preserves the preview after reload failure", () => {
    const pending = draftFixture();
    const approved = draftFixture({
      draftRevisionId: "ndrv_approved",
      draftRevisionNumber: 1,
      status: "approved",
    });
    let state = draftPanelReducer(INITIAL_DRAFT_PANEL_STATE, {
      type: "load-succeeded",
      drafts: [pending, approved],
    });
    state = draftPanelReducer(state, { type: "select", draftRevisionId: approved.draftRevisionId });
    state = draftPanelReducer(state, {
      type: "load-succeeded",
      drafts: [draftFixture({ draftRevisionId: "ndrv_new", draftRevisionNumber: 3 }), approved],
    });
    assert.equal(state.selectedRevisionId, approved.draftRevisionId);

    const failed = draftPanelReducer(state, {
      type: "load-failed",
      error: "Redis unavailable.",
    });
    assert.equal(failed.selectedRevisionId, approved.draftRevisionId);
    assert.deepEqual(failed.drafts, state.drafts);
    assert.equal(failed.status, "error");
    assert.equal(failed.error, "Redis unavailable.");

    const fallback = draftPanelReducer(failed, {
      type: "load-succeeded",
      drafts: [pending],
    });
    assert.equal(fallback.selectedRevisionId, pending.draftRevisionId);
  });

  it("clears actionable draft state when authorization or the feature gate is lost", () => {
    const pending = draftFixture();
    const loaded = draftPanelReducer(INITIAL_DRAFT_PANEL_STATE, {
      type: "load-succeeded",
      drafts: [pending],
    });
    const denied = draftPanelReducer(loaded, {
      type: "load-failed",
      error: "未授權存取。",
      accessDenied: true,
    });

    assert.deepEqual(denied.drafts, []);
    assert.equal(denied.selectedRevisionId, "");
    assert.equal(denied.status, "error");
    assert.equal(denied.error, "未授權存取。");
  });

  it("enables lifecycle actions only for a pending draft without another active action", () => {
    assert.deepEqual(draftActionState({ status: "pending" }, false), {
      approveDisabled: false,
      rejectDisabled: false,
    });
    assert.deepEqual(draftActionState({ status: "pending" }, true), {
      approveDisabled: true,
      rejectDisabled: true,
    });
    for (const status of ["approved", "rejected"]) {
      assert.deepEqual(draftActionState({ status }, false), {
        approveDisabled: true,
        rejectDisabled: true,
      });
    }
  });

  it("builds the complete five-event preview used by the panel", () => {
    const draft = draftFixture({ status: "approved" });
    const preview = buildDraftPreview(draft);

    assert.deepEqual(preview.identity, {
      briefDate: "2026-07-28",
      draftRevisionId: "ndrv_pending",
      draftRevisionNumber: 2,
      status: "approved",
    });
    assert.deepEqual(preview.analysis, {
      label: "risk_elevated",
      rationale: "Waiting for confirmation.",
    });
    assert.deepEqual(preview.timestamps, {
      generatedAt: "2026-07-28T00:00:00.000Z",
      createdAt: "2026-07-28T00:10:00.000Z",
      updatedAt: "2026-07-28T00:20:00.000Z",
      approvedAt: "2026-07-28T00:20:00.000Z",
      rejectedAt: null,
    });
    assert.equal(preview.evidence[0].url, "https://example.com/source");
    assert.equal(preview.evidence[0].summary, "Source summary.");
    assert.equal(preview.events.length, 5);
    assert.deepEqual(preview.events[4], draft.payload.events[4]);
    assert.deepEqual(preview.validationWarnings, draft.validationWarnings);
    assert.deepEqual(preview.dedupeWarnings, draft.dedupeWarnings);
    assert.deepEqual(preview.publishedBrief, {
      revisionId: "nbr_approved",
      revisionNumber: 3,
    });
    assert.deepEqual(preview.content.identity, {
      kind: "draft",
      briefDate: "2026-07-28",
      revisionId: "ndrv_pending",
      revisionNumber: 2,
      status: "approved",
    });
    assert.equal(preview.content.generatedAt, "2026-07-28T00:00:00.000Z");
    assert.equal(preview.content.events.length, 5);
  });

  it("loads drafts and sends exact approval and rejection request bodies", async () => {
    const calls = [];
    let terminalDraft = null;
    const fetchImpl = async (...args) => {
      calls.push(args);
      if (!args[1]?.method) {
        return Response.json({ drafts: [draftFixture()] });
      }
      terminalDraft = draftFixture({
        status: String(args[0]).includes("/reject") ? "rejected" : "approved",
      });
      return Response.json(String(args[0]).includes("/reject")
        ? { draft: terminalDraft }
        : { saved: true, draft: terminalDraft });
    };
    const controller = createDraftPanelController({
      fetchImpl,
      confirmImpl: () => true,
      promptImpl: () => "Needs more sources.",
    });
    const rejectionController = createDraftPanelController({
      fetchImpl,
      confirmImpl: () => true,
      promptImpl: () => "Needs more sources.",
    });
    const loaded = await controller.load({ token: "a b" });
    let reloads = 0;
    const reload = async () => {
      reloads += 1;
      return { drafts: [terminalDraft] };
    };

    await controller.approve({ token: "a b", draft: loaded.drafts[0], reload });
    await rejectionController.reject({ token: "a b", draft: loaded.drafts[0], reload });

    assert.equal(calls[0][0], "/api/dynamic-beta/news/drafts?token=a%20b");
    assert.deepEqual(calls[0][1], { cache: "no-store" });
    assert.equal(calls[1][0], "/api/dynamic-beta/news/drafts/approve?token=a%20b");
    assert.equal(calls[1][1].method, "POST");
    assert.deepEqual(JSON.parse(calls[1][1].body), {
      briefDate: "2026-07-28",
      draftRevisionId: "ndrv_pending",
    });
    assert.equal(calls[2][0], "/api/dynamic-beta/news/drafts/reject?token=a%20b");
    assert.equal(calls[2][1].method, "POST");
    assert.deepEqual(JSON.parse(calls[2][1].body), {
      briefDate: "2026-07-28",
      draftRevisionId: "ndrv_pending",
      reason: "Needs more sources.",
    });
    assert.equal(reloads, 2);
  });

  it("rejects malformed successful draft-list responses instead of replacing state with empty data", async () => {
    const controller = createDraftPanelController({
      async fetchImpl() {
        return Response.json({ configured: true });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    await assert.rejects(
      controller.load({ token: "token" }),
      /晨報草稿.*回應格式無效/,
    );
  });

  it("does not send lifecycle requests when the administrator cancels confirmation", async () => {
    let fetchCalls = 0;
    const controller = createDraftPanelController({
      async fetchImpl() {
        fetchCalls += 1;
        return Response.json({});
      },
      confirmImpl: () => false,
      promptImpl: () => "Optional reason.",
    });
    const draft = draftFixture();

    assert.deepEqual(await controller.approve({ token: "token", draft }), { cancelled: true });
    assert.deepEqual(await controller.reject({ token: "token", draft }), { cancelled: true });
    assert.equal(fetchCalls, 0);
  });

  it("applies a returned terminal draft before failed reconciliation and keeps the gate locked", async () => {
    const requestEntered = deferred();
    const finishRequest = deferred();
    let fetchCalls = 0;
    const controller = createDraftPanelController({
      async fetchImpl() {
        fetchCalls += 1;
        requestEntered.resolve();
        await finishRequest.promise;
        return Response.json({ saved: true, draft: draftFixture({ status: "approved" }) });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });
    const draft = draftFixture();
    const terminalDrafts = [];
    const first = controller.approve({
      token: "token",
      draft,
      async reload() { throw new Error("reload failed"); },
      onTerminalDraft(nextDraft) { terminalDrafts.push(nextDraft); },
    });
    await requestEntered.promise;

    assert.deepEqual(await controller.reject({ token: "token", draft }), { skipped: "busy" });
    assert.equal(fetchCalls, 1);
    finishRequest.resolve();
    await assert.rejects(first, /reload failed/);
    assert.equal(terminalDrafts.length, 1);
    assert.equal(terminalDrafts[0].status, "approved");
    assert.equal(controller.isLifecycleActive(), true);
    assert.equal(controller.getLifecycleSnapshot().phase, "uncertain");
    assert.equal(
      controller.applyDraftOverlays([draft])[0].status,
      "approved",
    );
  });

  it("surfaces a saved-false lifecycle message and keeps the outcome locked", async () => {
    const controller = createDraftPanelController({
      async fetchImpl() {
        return Response.json({ saved: false, error: "發布前驗證失敗。" });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    await assert.rejects(
      controller.approve({ token: "token", draft: draftFixture() }),
      /發布前驗證失敗/,
    );
    assert.equal(controller.getLifecycleSnapshot().phase, "uncertain");
    assert.equal(controller.isLifecycleActive(), true);
  });

  it("keeps a reconciled terminal overlay so a stale mounted panel cannot act again", async () => {
    const pending = draftFixture();
    const approved = draftFixture({ status: "approved" });
    let fetchCalls = 0;
    const controller = createDraftPanelController({
      async fetchImpl() {
        fetchCalls += 1;
        return Response.json({ saved: true, draft: approved });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    await controller.approve({
      token: "token",
      draft: pending,
      reload: async () => ({ drafts: [approved] }),
    });

    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.applyDraftOverlays([pending])[0].status, "approved");
    assert.deepEqual(
      await controller.reject({ token: "token", draft: pending }),
      { skipped: "status" },
    );
    assert.equal(fetchCalls, 1);
  });

  it("keeps every revision locked after a terminal post and stale successful reload", async () => {
    const firstPending = draftFixture();
    const secondPending = draftFixture({
      draftRevisionId: "ndrv_second_pending",
      draftRevisionNumber: 3,
    });
    const firstApproved = draftFixture({ status: "approved" });
    let serverDrafts = [firstPending, secondPending];
    let posts = 0;
    const controller = createDraftPanelController({
      async fetchImpl(url, options = {}) {
        if (options.method === "POST") {
          posts += 1;
          if (String(url).includes("/reject")) {
            return Response.json({
              draft: {
                ...secondPending,
                status: "rejected",
                rejectionReason: "Not authoritative yet.",
              },
            });
          }
          return Response.json({ saved: true, draft: firstApproved });
        }
        return Response.json({ drafts: serverDrafts });
      },
      confirmImpl: () => true,
      promptImpl: () => "Not authoritative yet.",
    });

    await controller.approve({
      token: "token",
      draft: firstPending,
      reload: () => controller.load({ token: "token" }),
    });
    const phaseAfterStaleReload = controller.getLifecycleSnapshot().phase;
    const secondResult = await controller.reject({
      token: "token",
      draft: secondPending,
    });

    assert.equal(phaseAfterStaleReload, "uncertain");
    assert.equal(controller.isLifecycleActive(), true);
    assert.deepEqual(secondResult, { skipped: "busy" });
    assert.equal(posts, 1);
    assert.equal(
      controller.applyDraftOverlays(serverDrafts)[0].status,
      "approved",
    );

    serverDrafts = [firstApproved, secondPending];
    await controller.load({ token: "token" });
    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.isLifecycleActive(), false);
  });

  it("broadcasts lifecycle access loss to a subscriber mounted after navigation", async () => {
    const requestEntered = deferred();
    const finishRequest = deferred();
    const pending = draftFixture();
    const controller = createDraftPanelController({
      async fetchImpl() {
        requestEntered.resolve();
        await finishRequest.promise;
        return Response.json({ error: "管理權限已失效。" }, { status: 403 });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    const action = controller.approve({ token: "token", draft: pending });
    await requestEntered.promise;

    const observed = [];
    const unsubscribe = controller.subscribeLifecycle(() => {
      observed.push(controller.getLifecycleSnapshot());
    });
    finishRequest.resolve();
    await assert.rejects(action, /管理權限已失效/);
    unsubscribe();

    assert.equal(observed.at(-1)?.phase, "access-denied");
    assert.match(observed.at(-1)?.error || "", /管理權限已失效/);
    assert.equal(controller.isLifecycleActive(), true);
    assert.deepEqual(controller.applyDraftOverlays([pending]), []);
    assert.deepEqual(
      await controller.reject({ token: "token", draft: pending }),
      { skipped: "busy" },
    );
  });

  it("recovers from access loss only after a validated retry started afterward", async () => {
    const pending = draftFixture();
    let call = 0;
    const controller = createDraftPanelController({
      async fetchImpl() {
        call += 1;
        if (call === 1) {
          return Response.json({ error: "管理權限已失效。" }, { status: 403 });
        }
        return Response.json({ drafts: [pending] });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    await assert.rejects(controller.load({ token: "token" }), /管理權限已失效/);
    const deniedEpoch = controller.getLifecycleSnapshot().accessEpoch;
    assert.equal(controller.getLifecycleSnapshot().phase, "access-denied");

    const recovered = await controller.load({ token: "corrected-token" });

    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, deniedEpoch);
    assert.equal(controller.isLifecycleActive(), false);
    assert.deepEqual(recovered.drafts, [pending]);
  });

  it("keeps a draft feature gate local instead of advancing workspace authorization", async () => {
    const observed = [];
    const controller = createDraftPanelController({
      async fetchImpl() {
        return Response.json(
          { enabled: false, error: "晨報草稿功能未啟用。" },
          { status: 404 },
        );
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });
    const unsubscribe = controller.subscribeLifecycle(() => {
      observed.push(controller.getLifecycleSnapshot());
    });

    await assert.rejects(
      controller.load({ token: "token" }),
      (error) => error?.kind === "gate",
    );
    unsubscribe();

    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, 0);
    assert.equal(observed.some((snapshot) => snapshot.phase === "access-denied"), false);
  });

  it("coordinates authorization epochs across independent admin readers", () => {
    const controller = createDraftPanelController({
      async fetchImpl() { throw new Error("fetch is not part of this contract"); },
      confirmImpl: () => true,
      promptImpl: () => "",
    });
    const authorization401 = Object.assign(new Error("authorization expired"), {
      kind: "authorization",
      status: 401,
    });
    const authorization403 = Object.assign(new Error("authorization denied"), {
      kind: "authorization",
      status: 403,
    });
    const gate = Object.assign(new Error("feature disabled"), { kind: "gate" });

    const readerA = controller.beginAccessRequest?.();
    const readerB = controller.beginAccessRequest?.();
    assert.equal(readerA, 0);
    assert.equal(readerB, 0);
    assert.equal(controller.reportAuthorizationLoss?.(authorization401, readerA), true);
    assert.equal(controller.getLifecycleSnapshot().phase, "access-denied");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, 1);
    assert.equal(controller.completeValidatedAccess?.(readerB), false);

    const retry = controller.beginAccessRequest?.();
    assert.equal(retry, 1);
    assert.equal(controller.completeValidatedAccess?.(retry), true);
    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, 1);

    assert.equal(controller.reportAuthorizationLoss?.(authorization403, readerB), false);
    assert.equal(controller.reportAuthorizationLoss?.(gate, retry), false);
    assert.equal(controller.isAccessRequestCurrent?.(readerB), false);
    assert.equal(controller.isAccessRequestCurrent?.(retry), true);
    assert.equal(controller.getLifecycleSnapshot().phase, "idle");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, 1);
  });

  it("ignores a successful draft read that started before a later access denial", async () => {
    const oldReadEntered = deferred();
    const finishOldRead = deferred();
    const pending = draftFixture();
    let call = 0;
    const controller = createDraftPanelController({
      async fetchImpl() {
        call += 1;
        if (call === 1) {
          oldReadEntered.resolve();
          await finishOldRead.promise;
          return Response.json({ drafts: [pending] });
        }
        return Response.json({ error: "管理權限已失效。" }, { status: 401 });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    const oldRead = controller.load({ token: "token" });
    await oldReadEntered.promise;
    await assert.rejects(controller.load({ token: "token" }), /管理權限已失效/);
    const deniedEpoch = controller.getLifecycleSnapshot().accessEpoch;

    finishOldRead.resolve();
    await assert.rejects(oldRead, /管理權限已失效/);

    assert.equal(controller.getLifecycleSnapshot().phase, "access-denied");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, deniedEpoch);
    assert.deepEqual(controller.applyDraftOverlays([pending]), []);
  });

  it("ignores a successful lifecycle response that started before access loss", async () => {
    const actionEntered = deferred();
    const finishAction = deferred();
    const pending = draftFixture();
    const approved = draftFixture({ status: "approved" });
    const controller = createDraftPanelController({
      async fetchImpl(url, options = {}) {
        if (options.method === "POST") {
          actionEntered.resolve();
          await finishAction.promise;
          return Response.json({ saved: true, draft: approved });
        }
        return Response.json({ error: "管理權限已失效。" }, { status: 403 });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    const action = controller.approve({ token: "token", draft: pending });
    await actionEntered.promise;
    await assert.rejects(controller.load({ token: "token" }), /管理權限已失效/);
    const deniedEpoch = controller.getLifecycleSnapshot().accessEpoch;

    finishAction.resolve();
    await assert.rejects(action, /管理權限已失效/);

    assert.equal(controller.getLifecycleSnapshot().phase, "access-denied");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, deniedEpoch);
    assert.deepEqual(controller.applyDraftOverlays([pending]), []);
  });

  it("preserves access loss when an older lifecycle request later fails transiently", async () => {
    const actionEntered = deferred();
    const finishAction = deferred();
    const pending = draftFixture();
    const controller = createDraftPanelController({
      async fetchImpl(url, options = {}) {
        if (options.method === "POST") {
          actionEntered.resolve();
          await finishAction.promise;
          return Response.json({ error: "Redis temporarily unavailable." }, { status: 503 });
        }
        return Response.json({ error: "管理權限已失效。" }, { status: 401 });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    const action = controller.approve({ token: "token", draft: pending });
    await actionEntered.promise;
    await assert.rejects(controller.load({ token: "token" }), /管理權限已失效/);
    const deniedEpoch = controller.getLifecycleSnapshot().accessEpoch;

    finishAction.resolve();
    await assert.rejects(action, /管理權限已失效/);

    assert.equal(controller.getLifecycleSnapshot().phase, "access-denied");
    assert.equal(controller.getLifecycleSnapshot().accessEpoch, deniedEpoch);
    assert.deepEqual(controller.applyDraftOverlays([pending]), []);
  });

  it("settles a repeated draft denial even when its phase and message are unchanged", async () => {
    const DailyMorningBriefDraftPanel = await loadDraftPanelComponent();
    const scheduled = [];
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      confirm: () => true,
      prompt: () => "",
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    };
    globalThis.fetch = async () => Response.json(
      { error: "unchanged authorization denial" },
      { status: 401 },
    );
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(DailyMorningBriefDraftPanel));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      assert.equal(buttonByText(renderer, "重試草稿").props.disabled, false);

      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試草稿").props.onClick();
        await nextTurn();
        await nextTurn();
      });

      assert.match(renderedText(renderer), /unchanged authorization denial/);
      assert.equal(buttonByText(renderer, "更新草稿").props.disabled, false);
      assert.equal(buttonByText(renderer, "重試草稿").props.disabled, false);
      assert.doesNotMatch(renderedText(renderer), /讀取中…/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("clears a pending draft read when denial and recovery publish in one batch", async () => {
    const DailyMorningBriefDraftPanel = await loadDraftPanelComponent();
    const scheduled = [];
    const delayedDraftRead = deferred();
    const pending = draftFixture();
    let draftReadMode = "success";
    const originalWindow = globalThis.window;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      confirm: () => true,
      prompt: () => "",
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const controller = createDraftPanelController({
      async fetchImpl() {
        if (draftReadMode === "deferred") return delayedDraftRead.promise;
        return Response.json({ drafts: [pending] });
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(DailyMorningBriefDraftPanel, {
          controller,
        }));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Draft revision ID: ndrv_pending/);

      draftReadMode = "deferred";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新草稿").props.onClick();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        const oldEpoch = controller.beginAccessRequest();
        const authorizationError = Object.assign(new Error("batched authorization denial"), {
          kind: "authorization",
          status: 401,
        });
        assert.equal(controller.reportAuthorizationLoss(authorizationError, oldEpoch), true);
        const recoveryEpoch = controller.beginAccessRequest();
        assert.equal(controller.completeValidatedAccess(recoveryEpoch), true);
      });

      assert.equal(controller.getLifecycleSnapshot().phase, "idle");
      assert.doesNotMatch(renderedText(renderer), /Draft revision ID: ndrv_pending/);
      assert.match(renderedText(renderer), /batched authorization denial/);
      assert.equal(buttonByText(renderer, "更新草稿").props.disabled, false);
      assert.equal(buttonByText(renderer, "重試草稿").props.disabled, false);

      delayedDraftRead.resolve(Response.json({ drafts: [pending] }));
      await TestRenderer.act(async () => { await nextTurn(); });
      assert.doesNotMatch(renderedText(renderer), /Draft revision ID: ndrv_pending/);
      assert.equal(buttonByText(renderer, "更新草稿").props.disabled, false);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutation caught: disconnecting the real panel from controller state or omitting any techEarnings field.
  it("renders complete earnings and pending, approved, and rejected action states in the real panel", async () => {
    const DailyMorningBriefDraftPanel = await loadDraftPanelComponent();
    const scheduled = [];
    const pending = draftFixture();
    let currentDraft = pending;
    let draftReadMode = "success";
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      confirm: () => true,
      prompt: () => "Needs another source.",
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("/approve") && options.method === "POST") {
        currentDraft = draftFixture({ status: "approved", approvedAt: null });
        return Response.json({ saved: true, draft: currentDraft });
      }
      if (draftReadMode === "denied") {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json({ drafts: [currentDraft] });
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(DailyMorningBriefDraftPanel));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });

      let approveButton = buttonByText(renderer, "核准並發布");
      let rejectButton = buttonByText(renderer, "拒絕草稿");
      assert.equal(approveButton.props.disabled, false);
      assert.equal(rejectButton.props.disabled, false);
      const actionGroups = renderer.root.findAllByProps({
        "aria-label": "晨報草稿 lifecycle 操作",
      });
      assert.equal(actionGroups.length, 1);
      assert.equal(actionGroups[0].props.className, "morningBriefLifecycleActions");
      assert.match(rejectButton.props.className, /morningBriefRejectButton/);
      let text = renderedText(renderer);
      assert.match(text, /科技財報公司 Example Cloud/);
      assert.match(text, /營收成長 12\.5%/);
      assert.match(text, /AI／雲端成長 尚未公布/);
      assert.match(text, /CapEx 成長 40%/);
      assert.match(text, /自由現金流成長 5%/);
      assert.match(text, /CapEx 成長快於自由現金流 是/);
      assert.match(text, /非科技財報事件/);
      assert.match(text, /核准時間 尚未核准/);
      assert.match(text, /拒絕時間 未遭拒絕/);
      assert.match(text, /拒絕原因 不適用/);
      assert.match(text, /已發布 Brief 尚未發布/);

      await TestRenderer.act(async () => {
        await approveButton.props.onClick();
        await nextTurn();
      });
      approveButton = buttonByText(renderer, "核准並發布");
      rejectButton = buttonByText(renderer, "拒絕草稿");
      assert.equal(Boolean(approveButton), false);
      assert.equal(Boolean(rejectButton), false);
      assert.equal(renderer.root.findAllByProps({
        "aria-label": "晨報草稿 lifecycle 操作",
      }).length, 0);
      text = renderedText(renderer);
      assert.match(text, /已核准/);
      assert.match(text, /核准時間 核准時間未提供/);
      assert.match(text, /拒絕時間 未遭拒絕/);
      assert.match(text, /拒絕原因 不適用/);

      currentDraft = draftFixture({
        status: "rejected",
        rejectionReason: null,
        rejectedAt: null,
      });
      await TestRenderer.act(async () => {
        renderer.unmount();
      });
      renderer = null;
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(DailyMorningBriefDraftPanel));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      approveButton = buttonByText(renderer, "核准並發布");
      rejectButton = buttonByText(renderer, "拒絕草稿");
      assert.equal(Boolean(approveButton), false);
      assert.equal(Boolean(rejectButton), false);
      text = renderedText(renderer);
      assert.match(text, /已拒絕/);
      assert.match(text, /核准時間 尚未核准/);
      assert.match(text, /拒絕時間 拒絕時間未提供/);
      assert.match(text, /拒絕原因 未提供駁回原因/);

      draftReadMode = "denied";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新草稿").props.onClick();
        await nextTurn();
      });
      text = renderedText(renderer);
      assert.match(text, /unauthorized/);
      assert.doesNotMatch(text, /Draft revision ID: ndrv_pending/);
      assert.doesNotMatch(text, /顯示上次成功讀取結果/);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => renderer.unmount());
      }
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutation caught: compacting away publication state or lifecycle actions.
  it("renders compact pending drafts with explicit unpublished mapping and actions", async () => {
    const DailyMorningBriefDraftPanel = await loadDraftPanelComponent();
    const scheduled = [];
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      confirm: () => true,
      prompt: () => "",
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async () => Response.json({ drafts: [draftFixture()] });
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(
          DailyMorningBriefDraftPanel,
          { compact: true },
        ));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });

      const text = renderedText(renderer);
      assert.match(text, /Draft Morning Brief/);
      assert.match(text, /分析標籤 risk_elevated/);
      assert.match(text, /分析理由 Waiting for confirmation\./);
      assert.match(text, /已發布 Brief 尚未發布/);
      for (let rank = 1; rank <= 5; rank += 1) {
        assert.match(text, new RegExp(`Event ${rank}`));
      }
      assert.equal(renderer.root.findAllByType("details").length, 0);
      assert.equal(buttonByText(renderer, "核准並發布").props.disabled, false);
      assert.equal(buttonByText(renderer, "拒絕草稿").props.disabled, false);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("keeps the private draft panel composed through the Today and Briefs sections", async () => {
    const [page, todaySection, briefsSection] = await Promise.all([
      readFile(
      new URL("../app/admin/dynamic-beta/page.js", import.meta.url),
      "utf8",
      ),
      readFile(
        new URL("../app/admin/dynamic-beta/TodayWorkspaceSection.js", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/admin/dynamic-beta/BriefsAdminSection.js", import.meta.url),
        "utf8",
      ),
    ]);

    assert.match(page, /import TodayWorkspaceSection/);
    assert.match(page, /import BriefsAdminSection/);
    for (const section of [todaySection, briefsSection]) {
      assert.match(section, /import DailyMorningBriefDraftPanel/);
      assert.match(section, /<DailyMorningBriefDraftPanel/);
    }
  });
});
