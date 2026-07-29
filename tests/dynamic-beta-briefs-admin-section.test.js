import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import {
  briefsAdminReducer,
  createBriefsAdminController,
  getSelectedPublishedBrief,
  INITIAL_BRIEFS_ADMIN_STATE,
} from "../src/lib/dynamic-beta/news/briefs-admin-state.js";
import { createDraftPanelController } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

function eventFixture(date, prefix) {
  return Array.from({ length: 5 }, (_, index) => ({
    rank: index + 1,
    headline: `${prefix} event ${index + 1}`,
    summary: `${prefix} summary ${index + 1}`,
    evidenceUrls: [`https://example.com/${prefix}/${index + 1}`],
    topicIds: ["global_macro_fed"],
    transmissionPath: ["event", "market", "asset"],
    affectedAssets: ["SPY"],
    marketDate: date,
    dataToConfirm: ["YAHOO:SPY"],
    confirmationRules: [{
      seriesId: "YAHOO:SPY",
      expectedDirection: "down",
      changeType: "percent",
      threshold: 1,
    }],
    interpretation: `${prefix} interpretation ${index + 1}`,
    confidence: 0.7,
    techEarnings: null,
  }));
}

function publishedFixture({
  briefDate = "2026-07-28",
  revisionId = "nbr_20260728_r2",
  revisionNumber = 2,
  prefix = "July 28",
} = {}) {
  return {
    briefDate,
    revisionId,
    revisionNumber,
    status: "published",
    generatedAt: `${briefDate}T00:00:00.000Z`,
    analystLabel: `${prefix} label`,
    analystRationale: `${prefix} rationale`,
    evidence: [{
      evidenceId: `evidence_${revisionId}`,
      revisionId: `evidence_revision_${revisionId}`,
      canonicalUrl: `https://example.com/${revisionId}`,
      title: `${prefix} source`,
      summary: `${prefix} source summary`,
      sourceName: "Example Source",
      sourceTier: "primary",
      publishedAt: `${briefDate}T00:00:00.000Z`,
      retrievedAt: `${briefDate}T00:05:00.000Z`,
    }],
    events: eventFixture(briefDate, prefix),
  };
}

function draftFixture({ status = "pending" } = {}) {
  return {
    draftId: "2026-07-28",
    draftRevisionId: "ndrv_20260728_pending",
    draftRevisionNumber: 4,
    briefDate: "2026-07-28",
    status,
    createdAt: "2026-07-28T00:10:00.000Z",
    updatedAt: "2026-07-28T00:20:00.000Z",
    approvedAt: status === "approved" ? "2026-07-28T00:30:00.000Z" : null,
    rejectedAt: null,
    rejectionReason: null,
    approvedBriefRevisionId: status === "approved" ? "nbr_20260728_r2" : null,
    approvedBriefRevisionNumber: status === "approved" ? 2 : null,
    validationWarnings: ["Check one source timestamp."],
    dedupeWarnings: [],
    payload: {
      generatedAt: "2026-07-28T00:00:00.000Z",
      analystLabel: "Draft label",
      analystRationale: "Draft rationale",
      evidence: publishedFixture().evidence,
      events: eventFixture("2026-07-28", "Draft"),
    },
  };
}

async function transformJsxModule(fileUrl, replacements) {
  let source = await readFile(fileUrl, "utf8");
  for (const [from, to] of replacements) source = source.replace(from, to);
  const jsxRuntimeUrl = new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href;
  const transformed = transformSync(source, {
    filename: fileUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  return `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
}

async function loadBriefsAdminSection() {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const adminHttpUrl = new URL(
    "../src/lib/dynamic-beta/admin-http.js",
    import.meta.url,
  ).href;
  const presenterUrl = new URL(
    "../src/lib/dynamic-beta/news/brief-presentation.js",
    import.meta.url,
  ).href;
  const morningBriefUrl = await transformJsxModule(
    new URL("../src/components/morning-brief/MorningBriefContent.js", import.meta.url),
    [[
      'from "../../lib/dynamic-beta/news/brief-presentation.js";',
      `from "${presenterUrl}";`,
    ]],
  );
  const controllerUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-panel-controller.js",
    import.meta.url,
  ).href;
  const draftViewUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-view.js",
    import.meta.url,
  ).href;
  const accessHookUrl = new URL(
    "../app/admin/dynamic-beta/useAdminAccessLifecycle.js",
    import.meta.url,
  ).href;
  const draftPanelUrl = await transformJsxModule(
    new URL("../app/admin/dynamic-beta/DailyMorningBriefDraftPanel.js", import.meta.url),
    [
      ['from "react";', `from "${reactUrl}";`],
      [
        'from "../../../src/lib/dynamic-beta/news/draft-panel-controller.js";',
        `from "${controllerUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/draft-view.js";',
        `from "${draftViewUrl}";`,
      ],
      [
        'from "../../../src/components/morning-brief/MorningBriefContent.js";',
        `from "${morningBriefUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/admin-http.js";',
        `from "${adminHttpUrl}";`,
      ],
      [
        'from "./useAdminAccessLifecycle.js";',
        `from "${accessHookUrl}";`,
      ],
    ],
  );
  const stateUrl = new URL(
    "../src/lib/dynamic-beta/news/briefs-admin-state.js",
    import.meta.url,
  ).href;
  const sectionUrl = await transformJsxModule(
    new URL("../app/admin/dynamic-beta/BriefsAdminSection.js", import.meta.url),
    [
      ['from "react";', `from "${reactUrl}";`],
      ['from "./DailyMorningBriefDraftPanel.js";', `from "${draftPanelUrl}";`],
      [
        'from "../../../src/components/morning-brief/MorningBriefContent.js";',
        `from "${morningBriefUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/brief-presentation.js";',
        `from "${presenterUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/briefs-admin-state.js";',
        `from "${stateUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/admin-http.js";',
        `from "${adminHttpUrl}";`,
      ],
      [
        'from "./useAdminAccessLifecycle.js";',
        `from "${accessHookUrl}";`,
      ],
    ],
  );
  return (await import(sectionUrl)).default;
}

function renderedText(node) {
  function visit(value) {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(visit).join(" ");
    return value?.children?.map(visit).join(" ") || "";
  }
  const value = typeof node.toJSON === "function" ? node.toJSON() : node;
  return visit(value).replace(/\s+/g, " ").trim();
}

function buttonByText(renderer, text) {
  return renderer.root.findAllByType("button").find((button) => (
    button.children.map(String).join("").includes(text)
  ));
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("briefs admin state", () => {
  it("stores draft and published revisions independently and defaults to the newest exact revision", () => {
    const july27 = publishedFixture({
      briefDate: "2026-07-27",
      revisionId: "nbr_20260727_r7",
      revisionNumber: 7,
      prefix: "July 27",
    });
    const july28Old = publishedFixture({
      revisionId: "nbr_20260728_r1",
      revisionNumber: 1,
    });
    const july28New = publishedFixture();
    const drafts = [draftFixture()];

    const state = briefsAdminReducer(INITIAL_BRIEFS_ADMIN_STATE, {
      type: "load-succeeded",
      drafts,
      briefs: [july27, july28Old, july28New],
    });

    assert.deepEqual(state.drafts, drafts);
    assert.deepEqual(
      state.publishedBriefs.map((brief) => brief.revisionId),
      ["nbr_20260728_r2", "nbr_20260728_r1", "nbr_20260727_r7"],
    );
    assert.equal(state.selectedPublishedRevisionId, "nbr_20260728_r2");
    assert.equal(getSelectedPublishedBrief(state), july28New);
  });

  it("refreshes either identity list without clearing the other", () => {
    const pending = draftFixture();
    const approved = draftFixture({ status: "approved" });
    const july28 = publishedFixture();
    let state = briefsAdminReducer(INITIAL_BRIEFS_ADMIN_STATE, {
      type: "load-succeeded",
      drafts: [pending],
      briefs: [july28],
    });

    state = briefsAdminReducer(state, {
      type: "load-succeeded",
      briefs: [publishedFixture({ revisionId: "nbr_20260728_r3", revisionNumber: 3 })],
    });
    assert.deepEqual(state.drafts, [pending]);

    state = briefsAdminReducer(state, {
      type: "load-succeeded",
      drafts: [approved],
    });
    assert.deepEqual(state.drafts, [approved]);
    assert.deepEqual(
      state.publishedBriefs.map((brief) => brief.revisionId),
      ["nbr_20260728_r3"],
    );
    assert.equal(state.selectedPublishedRevisionId, "nbr_20260728_r3");
  });

  it("preserves an exact published selection, then falls back deterministically if it disappears", () => {
    const july27 = publishedFixture({
      briefDate: "2026-07-27",
      revisionId: "nbr_20260727_r7",
      revisionNumber: 7,
      prefix: "July 27",
    });
    const july28 = publishedFixture();
    let state = briefsAdminReducer(INITIAL_BRIEFS_ADMIN_STATE, {
      type: "load-succeeded",
      briefs: [july28, july27],
    });
    state = briefsAdminReducer(state, {
      type: "select-published",
      revisionId: "nbr_20260727_r7",
    });
    state = briefsAdminReducer(state, {
      type: "load-succeeded",
      briefs: [publishedFixture({
        revisionId: "nbr_20260728_r3",
        revisionNumber: 3,
      }), july27],
    });
    assert.equal(state.selectedPublishedRevisionId, "nbr_20260727_r7");
    assert.equal(getSelectedPublishedBrief(state).briefDate, "2026-07-27");

    state = briefsAdminReducer(state, {
      type: "load-succeeded",
      briefs: [
        publishedFixture({ revisionId: "nbr_20260728_r1", revisionNumber: 1 }),
        publishedFixture({ revisionId: "nbr_20260728_r3", revisionNumber: 3 }),
      ],
    });
    assert.equal(state.selectedPublishedRevisionId, "nbr_20260728_r3");
  });

  it("keeps last-successful published content stale on failure and never selects a draft identity", () => {
    const brief = publishedFixture();
    const draft = draftFixture();
    let state = briefsAdminReducer(INITIAL_BRIEFS_ADMIN_STATE, {
      type: "load-succeeded",
      drafts: [draft],
      briefs: [brief],
    });
    const unchanged = briefsAdminReducer(state, {
      type: "select-published",
      draftRevisionId: draft.draftRevisionId,
    });
    assert.equal(unchanged.selectedPublishedRevisionId, brief.revisionId);

    state = briefsAdminReducer(unchanged, {
      type: "load-failed",
      error: "Redis unavailable.",
    });
    assert.deepEqual(state.drafts, [draft]);
    assert.deepEqual(state.publishedBriefs, [brief]);
    assert.equal(state.selectedPublishedRevisionId, brief.revisionId);
    assert.equal(state.status, "error");
    assert.equal(state.stale, true);
    assert.equal(state.error, "Redis unavailable.");
  });

  it("fails closed instead of retaining published content after authorization or gate denial", () => {
    const brief = publishedFixture();
    let state = briefsAdminReducer(INITIAL_BRIEFS_ADMIN_STATE, {
      type: "load-succeeded",
      briefs: [brief],
    });
    state = briefsAdminReducer(state, {
      type: "load-failed",
      error: "未授權存取。",
      accessDenied: true,
    });

    assert.deepEqual(state.publishedBriefs, []);
    assert.equal(state.selectedPublishedRevisionId, "");
    assert.equal(state.stale, false);
    assert.equal(state.status, "error");
  });

  it("loads published revisions from the existing authenticated news endpoint", async () => {
    const brief = publishedFixture();
    const calls = [];
    const controller = createBriefsAdminController({
      async fetchImpl(...args) {
        calls.push(args);
        return Response.json({ configured: true, briefs: [brief], evidence: [] });
      },
    });

    const payload = await controller.loadPublished({ token: "admin token" });

    assert.equal(calls[0][0], "/api/dynamic-beta/news?token=admin%20token");
    assert.deepEqual(calls[0][1], { cache: "no-store" });
    assert.deepEqual(payload.briefs, [brief]);
  });

  it("rejects malformed 2xx published responses and classifies access loss", async () => {
    for (const [response, expectedKind] of [
      [Response.json({ configured: true }), "malformed"],
      [Response.json({ error: "unauthorized" }, { status: 401 }), "authorization"],
      [Response.json({ enabled: false, error: "disabled" }, { status: 404 }), "gate"],
    ]) {
      const controller = createBriefsAdminController({
        async fetchImpl() { return response; },
      });
      await assert.rejects(
        controller.loadPublished({ token: "token" }),
        (error) => error?.kind === expectedKind,
      );
    }

    const missingTokenController = createBriefsAdminController({
      async fetchImpl() { throw new Error("fetch must not run"); },
    });
    await assert.rejects(
      missingTokenController.loadPublished({ token: "" }),
      (error) => error?.kind === "authorization",
    );
  });
});

describe("BriefsAdminSection", () => {
  // Mutations caught: mounting another admin workflow, compacting the draft, selecting by date,
  // clearing successful content on refresh errors, or submitting the published ID as a draft ID.
  it("renders exact full draft/published identities and preserves the selected 7/27 brief on failure", async () => {
    const BriefsAdminSection = await loadBriefsAdminSection();
    const july27 = publishedFixture({
      briefDate: "2026-07-27",
      revisionId: "nbr_20260727_r7",
      revisionNumber: 7,
      prefix: "July 27",
    });
    const july28 = publishedFixture();
    let currentDraft = draftFixture();
    let publishedMode = "success";
    const calls = [];
    const scheduled = [];
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
      calls.push([String(url), options]);
      if (String(url).includes("/drafts/approve")) {
        currentDraft = draftFixture({ status: "approved" });
        return Response.json({ saved: true, draft: currentDraft });
      }
      if (String(url).includes("/drafts")) {
        return Response.json({ drafts: [currentDraft] });
      }
      if (String(url).includes("/api/dynamic-beta/news")) {
        if (publishedMode === "transient") {
          return Response.json({ error: "Redis unavailable." }, { status: 500 });
        }
        if (publishedMode === "denied") {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        return Response.json({ configured: true, briefs: [july28, july27], evidence: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const sharedDraftController = createDraftPanelController({
      fetchImpl: (...args) => globalThis.fetch(...args),
      confirmImpl: () => true,
      promptImpl: () => "Needs another source.",
    });

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(BriefsAdminSection, {
          draftController: sharedDraftController,
          onAuthorizationLoss(error) {
            sharedDraftController.clearLifecycleAfterAccessLoss(error);
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      const initialUrls = calls.map(([url]) => url);
      assert.equal(initialUrls.length, 2);
      assert.ok(initialUrls.some((url) => url === "/api/dynamic-beta/news?token=admin-token"));
      assert.ok(initialUrls.some((url) => url === "/api/dynamic-beta/news/drafts?token=admin-token"));
      assert.ok(initialUrls.every((url) => !/market-data|score|confirmations/.test(url)));

      const draftView = renderer.root.findByProps({ "aria-label": "Draft revisions" });
      const publishedView = renderer.root.findByProps({ "aria-label": "Published revisions" });
      assert.match(renderedText(draftView), /Draft revision ID: ndrv_20260728_pending/);
      assert.match(renderedText(publishedView), /Published brief revision ID: nbr_20260728_r2/);
      for (let rank = 1; rank <= 5; rank += 1) {
        assert.match(renderedText(publishedView), new RegExp(`July 28 event ${rank}`));
        assert.match(renderedText(publishedView), new RegExp(`July 28 interpretation ${rank}`));
      }
      assert.equal(
        draftView.findAllByType("details").find((detail) => (
          detail.findByType("summary").children.join("") === "管理資訊"
        )).props.open,
        undefined,
      );

      const publishedSelect = publishedView.findByType("select");
      await TestRenderer.act(async () => {
        publishedSelect.props.onChange({ target: { value: "nbr_20260727_r7" } });
      });
      let publishedText = renderedText(publishedView);
      assert.match(publishedText, /Published brief revision ID: nbr_20260727_r7/);
      assert.match(publishedText, /2026-07-27/);
      for (let rank = 1; rank <= 5; rank += 1) {
        assert.match(publishedText, new RegExp(`July 27 event ${rank}`));
        assert.match(publishedText, new RegExp(`July 27 interpretation ${rank}`));
      }

      publishedMode = "transient";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      publishedText = renderedText(publishedView);
      assert.match(publishedText, /顯示上次成功讀取結果/);
      assert.ok(buttonByText(renderer, "重試讀取"));
      assert.match(publishedText, /Published brief revision ID: nbr_20260727_r7/);
      assert.match(publishedText, /July 27 event 5/);

      publishedMode = "denied";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      publishedText = renderedText(publishedView);
      assert.match(publishedText, /unauthorized/);
      assert.doesNotMatch(publishedText, /nbr_20260727_r7|July 27 event 5/);
      assert.doesNotMatch(publishedText, /顯示上次成功讀取結果/);

      assert.equal(sharedDraftController.getLifecycleSnapshot().phase, "access-denied");
      assert.equal(Boolean(buttonByText(renderer, "核准並發布")), false);
      assert.equal(calls.some(([url]) => url.includes("/drafts/approve")), false);

      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試草稿").props.onClick();
        await nextTurn();
      });
      assert.equal(sharedDraftController.getLifecycleSnapshot().phase, "idle");
      assert.equal(buttonByText(renderer, "核准並發布").props.disabled, false);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("clears and settles published state when a draft GET loses authorization", async () => {
    const BriefsAdminSection = await loadBriefsAdminSection();
    const scheduled = [];
    const delayedPublished = deferred();
    let draftMode = "success";
    let publishedMode = "success";
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
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/drafts?")) {
        if (draftMode === "denied") {
          return Response.json({ error: "draft authorization expired" }, { status: 401 });
        }
        return Response.json({ drafts: [draftFixture()] });
      }
      if (requestUrl.includes("/api/dynamic-beta/news?")) {
        if (publishedMode === "deferred") return delayedPublished.promise;
        return Response.json({ briefs: [publishedFixture()], evidence: [] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const adminAccess = createDraftPanelController({
      fetchImpl: (...args) => globalThis.fetch(...args),
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(BriefsAdminSection, {
          draftController: adminAccess,
          adminAccess,
          onAuthorizationLoss(error, requestAccessEpoch) {
            return adminAccess.reportAuthorizationLoss(error, requestAccessEpoch);
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Published brief revision ID: nbr_20260728_r2/);

      publishedMode = "deferred";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      draftMode = "denied";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新草稿").props.onClick();
        await nextTurn();
      });

      assert.equal(adminAccess.getLifecycleSnapshot().phase, "access-denied");
      assert.doesNotMatch(renderedText(renderer), /nbr_20260728_r2|July 28 event 1/);
      assert.doesNotMatch(renderedText(renderer), /顯示上次成功讀取結果/);
      const retry = buttonByText(renderer, "重試讀取");
      assert.ok(retry);
      assert.equal(retry.props.disabled, false);

      delayedPublished.resolve(Response.json({
        briefs: [publishedFixture({ prefix: "Old epoch" })],
        evidence: [],
      }));
      await TestRenderer.act(async () => { await nextTurn(); });
      assert.doesNotMatch(renderedText(renderer), /Old epoch|nbr_20260728_r2/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });
});
