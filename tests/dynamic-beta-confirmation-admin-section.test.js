import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import {
  confirmationAdminReducer,
  confirmationPreviewQuery,
  confirmationSnapshotQuery,
  createConfirmationPreviewAdminController,
  createConfirmationSnapshotAdminController,
  INITIAL_CONFIRMATION_ADMIN_STATE,
  summarizeConfirmationResult,
} from "../src/lib/dynamic-beta/news/confirmation-admin-state.js";
import { createDraftPanelController } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

const EVALUATOR_STATUSES = [
  "confirmed",
  "reverse",
  "unconfirmed",
  "observing",
  "insufficient_data",
  "not_configured",
];

function ruleFixture(status, index) {
  return {
    seriesId: `SERIES:${index}`,
    expectedDirection: "down",
    changeType: "percent",
    threshold: 2,
    baseline: { observationDate: "2026-07-25", value: 100 },
    d1: {
      status,
      observation: { observationDate: "2026-07-28", value: 98 },
      rawMove: -2,
      reason: `D1 ${status}`,
    },
    d3: {
      status,
      observation: { observationDate: "2026-07-30", value: 97 },
      rawMove: -3,
      reason: `D3 ${status}`,
    },
  };
}

function confirmationFixture() {
  const persistence = [
    "unchanged",
    "sustained",
    "faded",
    "observing",
    "insufficient_data",
    "not_configured",
  ];
  return {
    briefDate: "2026-07-27",
    revisionId: "nbr 20260727/r7",
    revisionNumber: 7,
    asOf: "2026-07-30",
    events: EVALUATOR_STATUSES.map((status, index) => ({
      rank: index + 1,
      headline: `Event ${index + 1}`,
      marketDate: "2026-07-27",
      d1: {
        status,
        isFinal: index % 2 === 0,
        counts: Object.fromEntries(EVALUATOR_STATUSES.map((key) => [key, key === status ? 1 : 0])),
      },
      d3: {
        status,
        isFinal: true,
        counts: Object.fromEntries(EVALUATOR_STATUSES.map((key) => [key, key === status ? 1 : 0])),
      },
      persistence: persistence[index],
      rules: [ruleFixture(status, index + 1)],
    })),
  };
}

function confirmationSnapshotFixture(overrides = {}) {
  return {
    ...confirmationFixture(),
    snapshotId: "ncs_saved_exact",
    snapshotRevisionNumber: 2,
    evaluatedAt: "2026-07-30T22:00:00.000Z",
    createdAt: "2026-07-30T22:01:00.000Z",
    completion: {
      complete: false,
      pendingReasons: [{
        eventRank: 2,
        seriesId: "SERIES:2",
        reason: "awaiting_observation",
      }],
    },
    metadata: {
      vintageMode: "latest_stored_revision_by_observation_date",
      truePointInTime: false,
    },
    ...overrides,
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

async function loadConfirmationAdminSection() {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const adminHttpUrl = new URL(
    "../src/lib/dynamic-beta/admin-http.js",
    import.meta.url,
  ).href;
  const stateUrl = new URL(
    "../src/lib/dynamic-beta/news/confirmation-admin-state.js",
    import.meta.url,
  ).href;
  const viewUrl = new URL(
    "../src/lib/dynamic-beta/news/confirmation-view.js",
    import.meta.url,
  ).href;
  const presenterUrl = new URL(
    "../src/lib/dynamic-beta/news/brief-presentation.js",
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
  const sectionUrl = await transformJsxModule(
    new URL("../app/admin/dynamic-beta/ConfirmationAdminSection.js", import.meta.url),
    [
      ['from "react";', `from "${reactUrl}";`],
      [
        'from "../../../src/components/morning-brief/MorningBriefContent.js";',
        `from "${morningBriefUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/confirmation-admin-state.js";',
        `from "${stateUrl}";`,
      ],
      [
        'from "../../../src/lib/dynamic-beta/news/confirmation-view.js";',
        `from "${viewUrl}";`,
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

function inputByLabel(renderer, labelText) {
  const label = renderer.root.findAllByType("label").find((candidate) => (
    renderedText(candidate).includes(labelText)
  ));
  return label.findByType("input");
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe("confirmation admin state", () => {
  // Mutations caught: dropping/reordering filters, accepting an unscoped revision, collapsing a
  // status into another meaning, deriving persistence, or clearing the last successful result.
  it("builds exact saved-snapshot and live Preview queries without widening revision scope", () => {
    assert.equal(
      confirmationSnapshotQuery({ token: "admin token" }),
      "/api/dynamic-beta/news/confirmation-snapshots?token=admin+token",
    );
    assert.equal(
      confirmationPreviewQuery({
        token: "admin token",
        briefDate: "2026-07-29",
        revisionId: "nbr exact",
        asOf: "2026-07-30",
      }),
      "/api/dynamic-beta/news/confirmations?token=admin+token&asOf=2026-07-30&briefDate=2026-07-29&revisionId=nbr+exact",
    );
    assert.equal(
      confirmationSnapshotQuery({
        token: "admin token",
        briefDate: "2026-07-27",
        asOf: "2026-07-30",
      }),
      "/api/dynamic-beta/news/confirmation-snapshots?token=admin+token&asOf=2026-07-30&briefDate=2026-07-27",
    );
    assert.throws(
      () => confirmationSnapshotQuery({
        token: "admin token",
        revisionId: "nbr_20260727_r7",
        asOf: "2026-07-30",
      }),
      { message: "Revision ID 必須搭配 Brief date。" },
    );
  });

  it("counts every evaluator status and uses supplied D3 persistence without deriving it", () => {
    const summary = summarizeConfirmationResult(confirmationFixture());

    assert.equal(summary.eventCount, 6);
    assert.deepEqual(summary.d1.counts, Object.fromEntries(
      EVALUATOR_STATUSES.map((status) => [status, 1]),
    ));
    assert.deepEqual(summary.d3.counts, Object.fromEntries(
      EVALUATOR_STATUSES.map((status) => [status, 1]),
    ));
    assert.deepEqual(summary.persistence, {
      sustained: 1,
      faded: 1,
      reversed: 0,
      emerged_late: 0,
      unchanged: 1,
      observing: 1,
      insufficient_data: 1,
      not_configured: 1,
    });
    assert.deepEqual(
      summary.persistenceItems.map(({ status }) => status),
      [
        "sustained",
        "faded",
        "unchanged",
        "observing",
        "insufficient_data",
        "not_configured",
      ],
    );
  });

  it("retains the prior result and marks it stale after refresh failure", () => {
    const result = confirmationFixture();
    let state = confirmationAdminReducer(INITIAL_CONFIRMATION_ADMIN_STATE, {
      type: "load-succeeded",
      result,
    });
    state = confirmationAdminReducer(state, { type: "load-started" });
    state = confirmationAdminReducer(state, {
      type: "load-failed",
      error: "Redis unavailable.",
    });

    assert.equal(state.result, result);
    assert.equal(state.status, "error");
    assert.equal(state.error, "Redis unavailable.");
    assert.equal(state.stale, true);
  });

  it("clears confirmation content and stale state after authorization or gate denial", () => {
    let state = confirmationAdminReducer(INITIAL_CONFIRMATION_ADMIN_STATE, {
      type: "load-succeeded",
      result: confirmationFixture(),
    });
    state = confirmationAdminReducer(state, {
      type: "load-failed",
      error: "未授權存取。",
      accessDenied: true,
    });

    assert.equal(state.result, null);
    assert.equal(state.stale, false);
    assert.equal(state.status, "error");
  });

  it("validates saved snapshot identity, completion, metadata, and events", async () => {
    const fixture = confirmationSnapshotFixture();
    for (const invalid of [
      { ...fixture, snapshotId: "" },
      { ...fixture, snapshotRevisionNumber: 2.5 },
      { ...fixture, completion: { pendingReasons: [] } },
      { ...fixture, metadata: null },
      { ...fixture, events: null },
    ]) {
      const controller = createConfirmationSnapshotAdminController({
        async fetchImpl() { return Response.json(invalid); },
      });
      await assert.rejects(
        controller.load({ token: "token" }),
        (error) => error?.kind === "malformed",
      );
    }

    const controller = createConfirmationSnapshotAdminController({
      async fetchImpl() { return Response.json(fixture); },
    });
    assert.deepEqual(await controller.load({ token: "token" }), fixture);
  });

  it("keeps live Preview validation and classifies access loss", async () => {
    for (const [response, expectedKind] of [
      [Response.json({ configured: true }), "malformed"],
      [Response.json({ error: "unauthorized" }, { status: 403 }), "authorization"],
      [Response.json({ enabled: false, error: "disabled" }, { status: 404 }), "gate"],
    ]) {
      const controller = createConfirmationPreviewAdminController({
        async fetchImpl() { return response; },
      });
      await assert.rejects(
        controller.load({ token: "token", asOf: "2026-07-30" }),
        (error) => error?.kind === expectedKind,
      );
    }

    const missingTokenController = createConfirmationPreviewAdminController({
      async fetchImpl() { throw new Error("fetch must not run"); },
    });
    await assert.rejects(
      missingTokenController.load({ token: "", asOf: "2026-07-30" }),
      (error) => error?.kind === "authorization",
    );
  });
});

describe("ConfirmationAdminSection", () => {
  it("loads the saved snapshot on mount and runs live Preview only after an explicit click", async () => {
    const ConfirmationAdminSection = await loadConfirmationAdminSection();
    const fixture = confirmationSnapshotFixture();
    const previewFixture = {
      ...confirmationFixture(),
      events: confirmationFixture().events.map((event) => ({
        ...event,
        headline: `Preview ${event.headline}`,
      })),
    };
    const calls = [];
    const scheduled = [];
    let responseMode = "success";
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      calls.push([requestUrl, options]);
      if (responseMode === "http-error") {
        return Response.json({ error: "Redis unavailable." }, { status: 500 });
      }
      if (responseMode === "parse-error") {
        return new Response("<html>gateway response</html>", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (responseMode === "shape-error") {
        return Response.json({ configured: true });
      }
      if (responseMode === "denied") {
        return Response.json({ error: "unauthorized" }, { status: 403 });
      }
      if (responseMode === "gate") {
        return Response.json({ enabled: false, error: "確認功能未啟用。" }, { status: 404 });
      }
      return Response.json(requestUrl.includes("/confirmation-snapshots?")
        ? fixture
        : previewFixture);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    let authorizationLosses = 0;

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(ConfirmationAdminSection, {
          onAuthorizationLoss() { authorizationLosses += 1; },
        }));
      });
      assert.equal(calls.length, 0);
      assert.equal(scheduled.length, 1);

      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      assert.deepEqual(calls[0], [
        "/api/dynamic-beta/news/confirmation-snapshots?token=admin-token",
        { cache: "no-store" },
      ]);
      assert.equal(
        calls.filter(([url]) => url.includes("/confirmations?")).length,
        0,
      );
      const savedText = renderedText(renderer);
      assert.match(savedText, /07:00 已保存快照/);
      assert.match(savedText, /Snapshot revision #2/);
      assert.match(savedText, /追蹤中/);
      assert.match(
        savedText,
        /資料採各 observation date 最新儲存 revision，並非完整 point-in-time vintage/,
      );

      await TestRenderer.act(async () => {
        inputByLabel(renderer, "Brief date").props.onChange({
          target: { value: "2026-07-27" },
        });
        inputByLabel(renderer, "Revision ID").props.onChange({
          target: { value: "nbr 20260727/r7" },
        });
        inputByLabel(renderer, "As of").props.onChange({
          target: { value: "2026-07-30" },
        });
      });
      assert.equal(scheduled.length, 0, "filter edits must remain manual after initial mount");
      await TestRenderer.act(async () => {
        buttonByText(renderer, "計算即時 Preview").props.onClick();
        await nextTurn();
      });
      assert.deepEqual(calls[1], [
        "/api/dynamic-beta/news/confirmations?token=admin-token&asOf=2026-07-30&briefDate=2026-07-27&revisionId=nbr+20260727%2Fr7",
        { cache: "no-store" },
      ]);

      const sectionText = renderedText(renderer);
      assert.match(sectionText, /即時 Preview（不會保存）/);
      assert.match(sectionText, /市場確認摘要/);
      assert.match(sectionText, /尚未設定確認規則/);
      assert.match(sectionText, /Event 1.*D1 主要確認：\s*已確認\s*（最終）.*D3 持續性：\s*未改變/);
      assert.match(sectionText, /Event 2.*D1 主要確認：\s*反向\s*（暫定）.*D3 持續性：\s*持續/);
      const eventDetails = renderer.root.findAllByProps({
        className: "confirmationAdminEvent",
      });
      assert.equal(eventDetails.length, 12);
      assert.ok(eventDetails.every((detail) => detail.props.open === undefined));
      assert.equal(renderer.root.findAllByProps({ className: "adminWideTableScroll" }).length, 12);
      const ruleTables = renderer.root.findAllByType("table");
      assert.equal(ruleTables.length, 12);
      for (const table of ruleTables) {
        assert.match(renderedText(table.findByType("caption")), /市場確認規則明細/);
        assert.equal(table.findAllByType("thead").length, 1);
        assert.equal(table.findAllByType("tbody").length, 1);
        const columnHeaders = table.findByType("thead").findAllByType("th");
        assert.equal(columnHeaders.length, 11);
        assert.ok(columnHeaders.every((header) => header.props.scope === "col"));
        const rowHeaders = table.findByType("tbody").findAllByType("th");
        assert.ok(rowHeaders.length > 0);
      assert.ok(rowHeaders.every((header) => header.props.scope === "row"));
      }
      assert.ok(calls.every(([, options]) => (
        options.method === undefined || options.method === "GET"
      )));

      responseMode = "http-error";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "計算即時 Preview").props.onClick();
        await nextTurn();
      });
      const staleText = renderedText(renderer);
      assert.match(staleText, /Redis unavailable/);
      assert.match(staleText, /顯示上次成功讀取結果/);
      assert.match(staleText, /Event 6/);
      assert.match(staleText, /Preview Event 6/);
      assert.ok(buttonByText(renderer, "重試 Preview"));

      responseMode = "parse-error";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試 Preview").props.onClick();
        await nextTurn();
      });
      const malformedText = renderedText(renderer);
      assert.match(malformedText, /Confirmation Preview 讀取失敗/);
      assert.match(malformedText, /顯示上次成功讀取結果/);
      assert.match(malformedText, /Event 6/);
      assert.ok(buttonByText(renderer, "重試 Preview"));
      assert.doesNotMatch(malformedText, /gateway response|Unexpected token/);

      responseMode = "shape-error";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試 Preview").props.onClick();
        await nextTurn();
      });
      const invalidShapeText = renderedText(renderer);
      assert.match(invalidShapeText, /Confirmation Preview.*回應格式無效/);
      assert.match(invalidShapeText, /顯示上次成功讀取結果/);
      assert.match(invalidShapeText, /Event 6/);

      const callsBeforeInvalidRevision = calls.length;
      await TestRenderer.act(async () => {
        inputByLabel(renderer, "Brief date").props.onChange({ target: { value: "" } });
      });
      await TestRenderer.act(async () => {
        buttonByText(renderer, "計算即時 Preview").props.onClick();
        await nextTurn();
      });
      assert.equal(calls.length, callsBeforeInvalidRevision);
      assert.match(renderedText(renderer), /Revision ID 必須搭配 Brief date/);
      assert.match(renderedText(renderer), /Event 6/);

      responseMode = "denied";
      await TestRenderer.act(async () => {
        inputByLabel(renderer, "Revision ID").props.onChange({ target: { value: "" } });
      });
      await TestRenderer.act(async () => {
        buttonByText(renderer, "計算即時 Preview").props.onClick();
        await nextTurn();
      });
      const deniedText = renderedText(renderer);
      assert.match(deniedText, /unauthorized/);
      assert.doesNotMatch(deniedText, /Event 6/);
      assert.doesNotMatch(deniedText, /顯示上次成功讀取結果/);
      assert.equal(authorizationLosses, 1);

      responseMode = "gate";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "重試 Preview").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /確認功能未啟用/);
      assert.equal(authorizationLosses, 1);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("fills a blank Preview as-of filter with the Asia/Taipei date at click time", async () => {
    const ConfirmationAdminSection = await loadConfirmationAdminSection();
    const calls = [];
    const scheduled = [];
    const OriginalDate = globalThis.Date;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.Date = class FixedDate extends OriginalDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-07-29T16:30:00.000Z"]));
      }
      static now() { return new OriginalDate("2026-07-29T16:30:00.000Z").getTime(); }
    };
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      calls.push([String(url), options]);
      return Response.json(String(url).includes("/confirmation-snapshots?")
        ? confirmationSnapshotFixture()
        : confirmationFixture());
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(ConfirmationAdminSection));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      assert.equal(inputByLabel(renderer, "As of").props.value, "");

      await TestRenderer.act(async () => {
        buttonByText(renderer, "計算即時 Preview").props.onClick();
        await nextTurn();
      });

      assert.deepEqual(calls.at(-1), [
        "/api/dynamic-beta/news/confirmations?token=admin-token&asOf=2026-07-30",
        { cache: "no-store" },
      ]);
      assert.equal(inputByLabel(renderer, "As of").props.value, "2026-07-30");
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.Date = OriginalDate;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("settles a stale read and clears its result when draft POST loses authorization", async () => {
    const ConfirmationAdminSection = await loadConfirmationAdminSection();
    const scheduled = [];
    const delayedConfirmation = deferred();
    let confirmationMode = "success";
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token" },
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    };
    globalThis.fetch = async () => (
      confirmationMode === "deferred"
        ? delayedConfirmation.promise
        : Response.json(confirmationSnapshotFixture())
    );
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const adminAccess = createDraftPanelController({
      fetchImpl: async (url) => {
        if (String(url).includes("/drafts/approve")) {
          return Response.json({ error: "draft authorization expired" }, { status: 403 });
        }
        throw new Error(`Unexpected draft request: ${url}`);
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });
    const pendingDraft = {
      briefDate: "2026-07-27",
      draftRevisionId: "ndrv_pending",
      draftRevisionNumber: 1,
      status: "pending",
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(ConfirmationAdminSection, {
          adminAccess,
        }));
      });
      await TestRenderer.act(async () => {
        scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Event 6/);

      confirmationMode = "deferred";
      await TestRenderer.act(async () => {
        buttonByText(renderer, "讀取已保存快照").props.onClick();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        await assert.rejects(adminAccess.approve({ token: "admin-token", draft: pendingDraft }));
        await nextTurn();
      });

      assert.doesNotMatch(renderedText(renderer), /Event 1|Event 6|顯示上次成功讀取結果/);
      assert.equal(buttonByText(renderer, "重試已保存快照").props.disabled, false);
      delayedConfirmation.resolve(Response.json(confirmationSnapshotFixture()));
      await TestRenderer.act(async () => { await nextTurn(); });
      assert.doesNotMatch(renderedText(renderer), /Event 1|Event 6/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });
});
