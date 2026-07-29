import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import { buildTodayWorkspaceModel } from "../src/lib/dynamic-beta/today-workspace.js";
import { createDraftPanelController } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

function eventFixture(rank, prefix = "Draft") {
  return {
    rank,
    headline: `${prefix} event ${rank}`,
    summary: `${prefix} summary ${rank}`,
    evidenceUrls: [],
    topicIds: ["macro"],
    suggestedTopicIds: [],
    transmissionPath: [],
    affectedAssets: [],
    marketDate: "2026-07-28",
    dataToConfirm: [],
    confirmationRules: [],
    interpretation: "Watch",
    confidence: "medium",
    techEarnings: null,
  };
}

function draftFixture({
  briefDate = "2026-07-28",
  draftRevisionId = "ndrv_exact_pending",
  draftRevisionNumber = 4,
  status = "pending",
  updatedAt = "2026-07-28T01:00:00.000Z",
} = {}) {
  return {
    draftId: briefDate,
    briefDate,
    draftRevisionId,
    draftRevisionNumber,
    status,
    createdAt: "2026-07-28T00:30:00.000Z",
    updatedAt,
    approvedAt: status === "approved" ? updatedAt : null,
    rejectedAt: null,
    rejectionReason: null,
    approvedBriefRevisionId: status === "approved" ? "nbr_published_exact" : null,
    approvedBriefRevisionNumber: status === "approved" ? 9 : null,
    validationWarnings: [],
    dedupeWarnings: [],
    payload: {
      briefDate,
      generatedAt: "2026-07-28T00:20:00.000Z",
      analystLabel: "Risk-off watch",
      analystRationale: "Rates and credit are diverging.",
      evidence: [],
      events: Array.from({ length: 6 }, (_, index) => eventFixture(index + 1)),
    },
  };
}

function briefFixture() {
  return {
    briefDate: "2026-07-28",
    revisionId: "nbr_published_exact",
    revisionNumber: 9,
    status: "published",
    generatedAt: "2026-07-28T01:10:00.000Z",
    analystLabel: "Published label",
    analystRationale: "Published rationale",
    evidence: [],
    events: Array.from({ length: 5 }, (_, index) => eventFixture(index + 1, "Published")),
  };
}

function confirmationFixture() {
  return {
    snapshotId: "ncs_today_saved",
    snapshotRevisionNumber: 2,
    briefDate: "2026-07-28",
    revisionId: "nbr_published_exact",
    revisionNumber: 9,
    asOf: "2026-07-29",
    evaluatedAt: "2026-07-29T22:00:00.000Z",
    createdAt: "2026-07-29T22:01:00.000Z",
    completion: { complete: false, pendingReasons: [] },
    metadata: {
      vintageMode: "latest_stored_revision_by_observation_date",
      truePointInTime: false,
    },
    events: [
      {
        rank: 1,
        d1: { status: "confirmed", isFinal: true },
        d3: { status: "observing", isFinal: false },
        persistence: "observing",
      },
      {
        rank: 2,
        d1: { status: "reverse", isFinal: true },
        d3: { status: "insufficient_data", isFinal: false },
        persistence: "insufficient_data",
      },
      {
        rank: 3,
        d1: { status: "not_configured", isFinal: true },
        d3: { status: "not_configured", isFinal: true },
        persistence: "not_configured",
      },
    ],
  };
}

function seriesFixture(seriesId, freshnessStatus) {
  return {
    seriesId,
    name: `${seriesId} series`,
    freshnessStatus,
    freshnessReason: `${freshnessStatus} reason`,
    updateStatus: freshnessStatus === "error" ? "error" : "success",
    observationDate: freshnessStatus === "never" ? null : "2026-07-28",
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

async function loadTodayWorkspaceSection() {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const presenterUrl = new URL(
    "../src/lib/dynamic-beta/news/brief-presentation.js",
    import.meta.url,
  ).href;
  const controllerUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-panel-controller.js",
    import.meta.url,
  ).href;
  const draftViewUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-view.js",
    import.meta.url,
  ).href;
  const todayModelUrl = new URL(
    "../src/lib/dynamic-beta/today-workspace.js",
    import.meta.url,
  ).href;
  const adminViewUrl = new URL(
    "../src/lib/dynamic-beta/admin-view.js",
    import.meta.url,
  ).href;
  const confirmationStateUrl = new URL(
    "../src/lib/dynamic-beta/news/confirmation-admin-state.js",
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
  const morningBriefUrl = await transformJsxModule(
    new URL("../src/components/morning-brief/MorningBriefContent.js", import.meta.url),
    [[
      'from "../../lib/dynamic-beta/news/brief-presentation.js";',
      `from "${presenterUrl}";`,
    ]],
  );
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
  const todaySectionUrl = await transformJsxModule(
    new URL("../app/admin/dynamic-beta/TodayWorkspaceSection.js", import.meta.url),
    [
      ['from "react";', `from "${reactUrl}";`],
      [
        'from "./DailyMorningBriefDraftPanel.js";',
        `from "${draftPanelUrl}";`,
      ],
      [
        'from "../../../src/components/morning-brief/MorningBriefContent.js";',
        `from "${morningBriefUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/today-workspace.js";',
        `from "${todayModelUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/admin-view.js";',
        `from "${adminViewUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/confirmation-admin-state.js";',
        `from "${confirmationStateUrl}";`,
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
  return (await import(todaySectionUrl)).default;
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
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

describe("Today workspace model", () => {
  it("keeps the newest draft identity, maps its publication, and limits compact events to five", () => {
    const older = draftFixture({
      briefDate: "2026-07-27",
      draftRevisionId: "ndrv_older",
      draftRevisionNumber: 12,
      updatedAt: "2026-07-27T23:50:00.000Z",
    });
    const approved = draftFixture({ status: "approved" });
    const model = buildTodayWorkspaceModel({
      drafts: [older, approved],
      briefs: [briefFixture()],
      confirmationResult: confirmationFixture(),
      series: [
        seriesFixture("FRESH", "fresh"),
        seriesFixture("DELAYED", "delayed"),
        seriesFixture("STALE", "stale"),
        seriesFixture("NEVER", "never"),
        seriesFixture("ERROR", "error"),
      ],
    });

    assert.deepEqual(model.draft.identity, {
      briefDate: "2026-07-28",
      draftRevisionId: "ndrv_exact_pending",
      draftRevisionNumber: 4,
      status: "approved",
    });
    assert.deepEqual(model.draft.publishedBrief, {
      revisionId: "nbr_published_exact",
      revisionNumber: 9,
    });
    assert.equal(model.brief.identity.revisionId, "nbr_published_exact");
    assert.deepEqual(
      model.eventSummaries.map(({ rank, headline, summary }) => ({ rank, headline, summary })),
      Array.from({ length: 5 }, (_, index) => ({
        rank: index + 1,
        headline: `Published event ${index + 1}`,
        summary: `Published summary ${index + 1}`,
      })),
    );
    assert.deepEqual(
      model.market.alerts.map((item) => item.seriesId),
      ["ERROR", "NEVER", "STALE", "DELAYED"],
    );
  });

  it("preserves confirmation statuses and returns explicit independent empty states", () => {
    const populated = buildTodayWorkspaceModel({
      drafts: [],
      briefs: [briefFixture()],
      confirmationResult: confirmationFixture(),
      series: [seriesFixture("FRESH", "fresh")],
    });
    assert.deepEqual(populated.confirmation.d1.counts, {
      confirmed: 1,
      reverse: 1,
      unconfirmed: 0,
      observing: 0,
      insufficient_data: 0,
      not_configured: 1,
    });
    assert.deepEqual(populated.confirmation.d3.counts, {
      confirmed: 0,
      reverse: 0,
      unconfirmed: 0,
      observing: 1,
      insufficient_data: 1,
      not_configured: 1,
    });
    assert.equal(populated.confirmation.stage, "d3_tracking");
    assert.equal(populated.market.emptyState, null);
    assert.equal(populated.market.alertEmptyState, "目前沒有異常市場資料。");

    const empty = buildTodayWorkspaceModel({});
    assert.equal(empty.draft.emptyState, "目前沒有晨報草稿。");
    assert.equal(empty.brief.emptyState, "目前沒有已發布晨報。");
    assert.equal(empty.confirmation.emptyState, "目前沒有市場確認結果。");
    assert.equal(empty.market.emptyState, "目前沒有市場資料。");
    assert.deepEqual(empty.eventSummaries, []);
    assert.deepEqual(empty.market.alerts, []);
  });
});

describe("TodayWorkspaceSection", () => {
  it("announces each initial read locally without rendering empty conclusions", async () => {
    const TodayWorkspaceSection = await loadTodayWorkspaceSection();
    const scheduled = [];
    const pending = {
      briefs: deferred(),
      confirmation: deferred(),
      market: deferred(),
    };
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
    globalThis.fetch = async (url) => {
      if (String(url).includes("/drafts?")) return Response.json({ drafts: [] });
      if (String(url).includes("/confirmation-snapshots?")) return pending.confirmation.promise;
      if (String(url).includes("/admin?")) return pending.market.promise;
      if (String(url).includes("/news?")) return pending.briefs.promise;
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(TodayWorkspaceSection, {
          onOpenSection() {},
        }));
      });

      const beforeTimers = renderedText(renderer);
      for (const titleId of [
        "today-brief-title",
        "today-confirmation-title",
        "today-market-title",
      ]) {
        const block = renderer.root.findByProps({ "aria-labelledby": titleId });
        assert.equal(block.props["aria-busy"], true);
        assert.ok(block.findAllByProps({ role: "status" }).length >= 1);
        assert.equal(block.findAllByType("button").some((button) => (
          renderedText(button).includes("讀取中")
        )), true);
      }
      assert.match(beforeTimers, /晨報草稿讀取中/);
      assert.doesNotMatch(beforeTimers, /目前階段：確認結果尚未提供/);
      assert.doesNotMatch(beforeTimers, /目前沒有可預覽的晨報草稿/);

      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      const loadingSnapshots = [
        ["today-brief-title", "已發布晨報讀取中"],
        ["today-confirmation-title", "已保存快照讀取中"],
        ["today-market-title", "市場資料讀取中"],
      ].map(([titleId, statusText]) => {
        const block = renderer.root.findByProps({ "aria-labelledby": titleId });
        return {
          busy: block.props["aria-busy"],
          text: renderedText(block),
          statusCount: block.findAllByProps({ role: "status" }).length,
          hasBusyButton: block.findAllByType("button").some((button) => (
            renderedText(button).includes("讀取中")
          )),
          statusText,
        };
      });
      const loadingText = renderedText(renderer);

      await TestRenderer.act(async () => {
        pending.briefs.resolve(Response.json({ briefs: [] }));
        pending.confirmation.resolve(Response.json(confirmationFixture()));
        pending.market.resolve(Response.json({ series: [] }));
        await nextTurn();
      });

      for (const snapshot of loadingSnapshots) {
        assert.equal(snapshot.busy, true);
        assert.match(snapshot.text, new RegExp(snapshot.statusText));
        assert.ok(snapshot.statusCount >= 1);
        assert.equal(snapshot.hasBusyButton, true);
      }
      assert.doesNotMatch(
        loadingText,
        /目前沒有草稿或已發布晨報|目前沒有已保存的 D1／D3 快照|目前沒有市場資料|目前沒有異常市場資料/,
      );
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("keeps draft and abnormal data useful when confirmations fail and routes local shortcuts", async () => {
    const TodayWorkspaceSection = await loadTodayWorkspaceSection();
    const calls = [];
    const scheduled = [];
    const opened = [];
    const fresh = seriesFixture("FRESH", "fresh");
    const delayed = seriesFixture("DELAYED", "delayed");
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
    globalThis.fetch = async (url, options = {}) => {
      const request = [String(url), options];
      calls.push(request);
      if (String(url) === "/api/dynamic-beta/news/drafts?token=admin-token") {
        return Response.json({ drafts: [draftFixture()] });
      }
      if (String(url) === "/api/dynamic-beta/news?token=admin-token") {
        return Response.json({ briefs: [briefFixture()] });
      }
      if (String(url) === "/api/dynamic-beta/admin?token=admin-token") {
        return Response.json({ series: [fresh, delayed] });
      }
      if (String(url).startsWith("/api/dynamic-beta/news/confirmation-snapshots?")) {
        return Response.json({ error: "Confirmation unavailable." }, { status: 503 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(TodayWorkspaceSection, {
          onOpenSection: (sectionId) => opened.push(sectionId),
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
        await nextTurn();
      });

      const text = renderedText(renderer);
      assert.match(text, /內部功能；Scoring 與公開功能仍關閉/);
      assert.match(text, /ndrv_exact_pending/);
      assert.match(text, /Draft event 5/);
      assert.doesNotMatch(text, /Draft event 6/);
      assert.match(text, /DELAYED series/);
      assert.doesNotMatch(text, /FRESH series/);
      assert.match(text, /Confirmation unavailable/);
      assert.ok(buttonByText(renderer, "重試市場確認"));
      assert.equal(buttonByText(renderer, "核准並發布").props.disabled, false);
      assert.equal(buttonByText(renderer, "拒絕草稿").props.disabled, false);

      await TestRenderer.act(async () => {
        buttonByText(renderer, "查看完整晨報").props.onClick();
        buttonByText(renderer, "查看確認詳情").props.onClick();
        buttonByText(renderer, "查看全部資料").props.onClick();
      });
      assert.deepEqual(opened, ["briefs", "confirmations", "data"]);

      assert.deepEqual(
        calls.map(([url]) => url).sort(),
        [
          "/api/dynamic-beta/admin?token=admin-token",
          "/api/dynamic-beta/news/drafts?token=admin-token",
          "/api/dynamic-beta/news?token=admin-token",
          "/api/dynamic-beta/news/confirmation-snapshots?token=admin-token",
        ].sort(),
      );
      assert.ok(calls.every(([, options]) => options.method === undefined));
      assert.ok(calls.every(([url]) => !url.includes("score-preview")));

      const beforeRetry = calls.length;
      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試市場確認").props.onClick();
        await nextTurn();
      });
      assert.equal(calls.length, beforeRetry + 1);
      assert.match(calls.at(-1)[0], /\/news\/confirmation-snapshots\?/);
      assert.equal(calls.some(([url]) => url.includes("/news/confirmations?")), false);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("keeps approved draft lifecycle actions disabled", async () => {
    const TodayWorkspaceSection = await loadTodayWorkspaceSection();
    const scheduled = [];
    let confirmationFails = false;
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
    globalThis.fetch = async (url) => {
      if (String(url).includes("/drafts?")) {
        return Response.json({ drafts: [draftFixture({ status: "approved" })] });
      }
      if (String(url).includes("/news?")) return Response.json({ briefs: [briefFixture()] });
      if (String(url).includes("/admin?")) return Response.json({ series: [] });
      if (String(url).includes("/confirmation-snapshots?")) {
        return confirmationFails
          ? Response.json({ error: "Confirmation refresh failed." }, { status: 503 })
          : Response.json(confirmationFixture());
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(TodayWorkspaceSection, {
          onOpenSection() {},
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
        await nextTurn();
      });
      assert.equal(Boolean(buttonByText(renderer, "核准並發布")), false);
      assert.equal(Boolean(buttonByText(renderer, "拒絕草稿")), false);
      assert.match(renderedText(renderer), /nbr_published_exact/);
      assert.match(renderedText(renderer), /D3 追蹤中/);

      confirmationFails = true;
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已保存快照").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Confirmation refresh failed/);
      assert.match(renderedText(renderer), /顯示上次成功讀取結果/);
      assert.match(renderedText(renderer), /D3 追蹤中/);
      assert.ok(buttonByText(renderer, "重試市場確認"));
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("retains malformed transient content but clears resources after authorization or gate loss", async () => {
    const TodayWorkspaceSection = await loadTodayWorkspaceSection();
    const scheduled = [];
    const modes = {
      briefs: "success",
      confirmation: "success",
      market: "success",
    };
    const delayedBriefRefresh = deferred();
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
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/drafts?")) return Response.json({ drafts: [] });
      if (requestUrl.includes("/confirmation-snapshots?")) {
        if (modes.confirmation === "gate") {
          return Response.json({ enabled: false, error: "確認功能未啟用。" }, { status: 404 });
        }
        return Response.json(confirmationFixture());
      }
      if (requestUrl.includes("/admin?")) {
        if (modes.market === "denied") {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        return Response.json({ series: [seriesFixture("DELAYED", "delayed")] });
      }
      if (requestUrl.includes("/news?")) {
        if (modes.briefs === "malformed") return Response.json({ configured: true });
        if (modes.briefs === "deferred") return delayedBriefRefresh.promise;
        return Response.json({ briefs: [briefFixture()] });
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
      promptImpl: () => "",
    });
    let authorizationLosses = 0;

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(TodayWorkspaceSection, {
          onOpenSection() {},
          draftController: sharedDraftController,
          adminAccess: sharedDraftController,
          onAuthorizationLoss(error, requestAccessEpoch) {
            authorizationLosses += 1;
            return sharedDraftController.reportAuthorizationLoss(
              error,
              requestAccessEpoch,
            );
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Published event 1/);
      assert.match(renderedText(renderer), /DELAYED series/);
      assert.match(renderedText(renderer), /D3 追蹤中/);

      modes.briefs = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      const briefBlock = renderer.root.findByProps({
        "aria-labelledby": "today-brief-title",
      });
      assert.match(renderedText(briefBlock), /已發布晨報.*回應格式無效/);
      assert.match(renderedText(briefBlock), /顯示上次成功讀取結果/);
      assert.match(renderedText(briefBlock), /Published event 1/);

      modes.briefs = "deferred";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      modes.market = "denied";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新市場資料").props.onClick();
        await nextTurn();
      });
      const marketBlock = renderer.root.findByProps({
        "aria-labelledby": "today-market-title",
      });
      assert.match(renderedText(marketBlock), /unauthorized/);
      assert.doesNotMatch(renderedText(marketBlock), /DELAYED series/);
      assert.doesNotMatch(renderedText(marketBlock), /顯示上次成功讀取結果/);
      assert.equal(authorizationLosses, 1);
      assert.equal(sharedDraftController.getLifecycleSnapshot().phase, "access-denied");
      const deniedEpoch = sharedDraftController.getLifecycleSnapshot().accessEpoch;
      assert.doesNotMatch(renderedText(briefBlock), /Published event 1/);
      assert.doesNotMatch(renderedText(renderer), /D3 追蹤中/);

      await TestRenderer.act(async () => {
        delayedBriefRefresh.resolve(Response.json({ briefs: [briefFixture()] }));
        await nextTurn();
      });
      assert.doesNotMatch(renderedText(briefBlock), /Published event 1/);

      modes.briefs = "success";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新已發布晨報").props.onClick();
        await nextTurn();
      });
      assert.equal(sharedDraftController.getLifecycleSnapshot().phase, "idle");
      assert.equal(sharedDraftController.getLifecycleSnapshot().accessEpoch, deniedEpoch);
      assert.match(renderedText(briefBlock), /Published event 1/);

      modes.confirmation = "gate";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新已保存快照").props.onClick();
        await nextTurn();
      });
      const confirmationBlock = renderer.root.findByProps({
        "aria-labelledby": "today-confirmation-title",
      });
      assert.match(renderedText(confirmationBlock), /確認功能未啟用/);
      assert.doesNotMatch(renderedText(confirmationBlock), /市場確認摘要/);
      assert.doesNotMatch(renderedText(confirmationBlock), /顯示上次成功讀取結果/);
      assert.equal(authorizationLosses, 1);
      assert.equal(sharedDraftController.getLifecycleSnapshot().accessEpoch, deniedEpoch);
      assert.match(renderedText(briefBlock), /Published event 1/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("draft POST authorization loss clears and settles every Today resource", async () => {
    const TodayWorkspaceSection = await loadTodayWorkspaceSection();
    const scheduled = [];
    const delayedMarket = deferred();
    let draftMode = "empty";
    let marketMode = "success";
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
      if (requestUrl.includes("/drafts/approve")) {
        return Response.json({ error: "draft lifecycle authorization expired" }, { status: 403 });
      }
      if (requestUrl.includes("/drafts?")) {
        return Response.json({ drafts: draftMode === "pending" ? [draftFixture()] : [] });
      }
      if (requestUrl.includes("/confirmation-snapshots?")) return Response.json(confirmationFixture());
      if (requestUrl.includes("/admin?")) {
        if (marketMode === "deferred") return delayedMarket.promise;
        return Response.json({ series: [seriesFixture("DELAYED", "delayed")] });
      }
      if (requestUrl.includes("/news?")) return Response.json({ briefs: [briefFixture()] });
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
        renderer = TestRenderer.create(React.createElement(TodayWorkspaceSection, {
          onOpenSection() {},
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
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Published event 1/);
      assert.match(renderedText(renderer), /D3 追蹤中/);
      assert.match(renderedText(renderer), /DELAYED series/);

      draftMode = "pending";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新草稿").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Draft event 1/);

      marketMode = "deferred";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "更新市場資料").props.onClick();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        buttonByText(renderer, "核准並發布").props.onClick();
        await nextTurn();
      });

      assert.equal(adminAccess.getLifecycleSnapshot().phase, "access-denied");
      assert.doesNotMatch(
        renderedText(renderer),
        /Published event 1|Draft event 1|D3 追蹤中|DELAYED series|顯示上次成功讀取結果/,
      );
      for (const id of ["today-brief-title", "today-confirmation-title", "today-market-title"]) {
        assert.equal(renderer.root.findByProps({ "aria-labelledby": id }).props["aria-busy"], false);
      }
      for (const label of ["更新已發布晨報", "更新已保存快照", "更新市場資料"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, false);
      }

      delayedMarket.resolve(Response.json({
        series: [seriesFixture("OLD-EPOCH", "delayed")],
      }));
      await TestRenderer.act(async () => { await nextTurn(); });
      assert.doesNotMatch(renderedText(renderer), /OLD-EPOCH/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });
});
