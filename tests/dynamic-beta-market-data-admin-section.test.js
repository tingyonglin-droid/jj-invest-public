import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import { summarizeDynamicBetaSeries } from "../src/lib/dynamic-beta/admin-view.js";
import { createDraftPanelController } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

function seriesFixture(seriesId, freshnessStatus, overrides = {}) {
  return {
    seriesId,
    name: `${seriesId} name`,
    category: "test",
    source: "FRED",
    frequency: "Daily",
    unit: "Percent",
    enabled: true,
    latestValue: 1,
    observationDate: "2026-07-27",
    retrievedAt: "2026-07-28T01:00:00.000Z",
    releasedAt: null,
    sourceRealtimeStart: "2026-07-27",
    sourceRealtimeEnd: "2026-07-27",
    firstSeenAt: "2026-07-28T01:00:00.000Z",
    lastSeenAt: "2026-07-28T01:00:00.000Z",
    freshnessStatus,
    freshnessAge: 1,
    freshnessFreshThreshold: 2,
    freshnessStaleThreshold: 4,
    freshnessReason: `${freshnessStatus} reason`,
    updateStatus: "success",
    lastSuccessAt: "2026-07-28T01:01:00.000Z",
    error: null,
    ...overrides,
  };
}

async function loadMarketDataAdminSection() {
  const fileUrl = new URL(
    "../app/admin/dynamic-beta/MarketDataAdminSection.js",
    import.meta.url,
  );
  let source = await readFile(fileUrl, "utf8");
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const adminViewUrl = new URL(
    "../src/lib/dynamic-beta/admin-view.js",
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
  source = source
    .replace('from "react";', `from "${reactUrl}";`)
    .replace(
      'from "../../../src/lib/dynamic-beta/admin-view.js";',
      `from "${adminViewUrl}";`,
    )
    .replace(
      'from "../../../src/lib/dynamic-beta/admin-http.js";',
      `from "${adminHttpUrl}";`,
    )
    .replace(
      'from "./useAdminAccessLifecycle.js";',
      `from "${accessHookUrl}";`,
    );
  const jsxRuntimeUrl = new URL(
    "../node_modules/react/jsx-runtime.js",
    import.meta.url,
  ).href;
  const transformed = transformSync(source, {
    filename: fileUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
  return (await import(moduleUrl)).default;
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

describe("dynamic beta market-data summary", () => {
  // Mutations caught: treating delayed as normal, deriving freshness from updateStatus,
  // changing severity order, or sorting catalog peers by name/ID.
  it("counts each exact freshness status once and orders abnormal rows by severity", () => {
    const delayedFirst = seriesFixture("DELAYED-1", "delayed", {
      updateStatus: "error",
    });
    const fresh = seriesFixture("FRESH", "fresh");
    const stale = seriesFixture("STALE", "stale");
    const never = seriesFixture("NEVER", "never", { updateStatus: "never" });
    const errorFirst = seriesFixture("ERROR-1", "error");
    const delayedSecond = seriesFixture("DELAYED-2", "delayed");
    const errorSecond = seriesFixture("ERROR-2", "error");

    const summary = summarizeDynamicBetaSeries([
      delayedFirst,
      fresh,
      stale,
      never,
      errorFirst,
      delayedSecond,
      errorSecond,
    ]);

    assert.deepEqual(summary.counts, {
      fresh: 1,
      delayed: 2,
      stale: 1,
      never: 1,
      error: 2,
    });
    assert.deepEqual(summary.normal, [fresh]);
    assert.deepEqual(
      summary.alerts.map((item) => item.seriesId),
      ["ERROR-1", "ERROR-2", "NEVER", "STALE", "DELAYED-1", "DELAYED-2"],
    );
    assert.equal(summary.alerts.length + summary.normal.length, 7);
    assert.equal(summary.alerts.at(-2), delayedFirst);
  });

  it("returns complete zero counts for an empty catalog", () => {
    assert.deepEqual(summarizeDynamicBetaSeries([]), {
      counts: { fresh: 0, delayed: 0, stale: 0, never: 0, error: 0 },
      alerts: [],
      normal: [],
    });
  });
});

describe("MarketDataAdminSection", () => {
  it("announces honest initial loading without zero or empty-data conclusions", async () => {
    const MarketDataAdminSection = await loadMarketDataAdminSection();
    const scheduled = [];
    const response = deferred();
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
    globalThis.fetch = async () => response.promise;
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(MarketDataAdminSection));
      });
      const section = renderer.root.findByProps({
        "aria-labelledby": "market-data-title",
      });
      assert.equal(section.props["aria-busy"], true);
      assert.ok(buttonByText(renderer, "讀取中…"));
      assert.match(renderedText(renderer), /市場資料讀取中/);
      assert.equal(renderer.root.findAllByProps({
        "aria-label": "市場資料新鮮度摘要",
      }).length, 0);
      assert.doesNotMatch(renderedText(renderer), /目前沒有異常資料|沒有資料/);

      await TestRenderer.act(async () => {
        scheduled.shift()();
        response.resolve(Response.json({ configured: true, enabled: true, series: [] }));
        await nextTurn();
      });
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: eager-loading another workspace workflow, clearing rows on an
  // ordinary refresh failure, opening normal rows by default, or rendering catalog order.
  it("renders abnormal rows first and retains the last successful result after refresh failure", async () => {
    const MarketDataAdminSection = await loadMarketDataAdminSection();
    const fresh = seriesFixture("FRESH", "fresh", { name: "Fresh series" });
    const delayed = seriesFixture("DELAYED", "delayed", { name: "Delayed series" });
    const never = seriesFixture("NEVER", "never", {
      name: "Never series",
      latestValue: null,
      observationDate: null,
      retrievedAt: null,
      releasedAt: null,
      sourceRealtimeStart: null,
      sourceRealtimeEnd: null,
      firstSeenAt: null,
      lastSeenAt: null,
      updateStatus: "never",
      freshnessReason: "尚無可用 observation。",
    });
    const error = seriesFixture("ERROR", "error", {
      name: "Failed series",
      source: "Yahoo Finance",
      sourceRealtimeStart: null,
      sourceRealtimeEnd: null,
      updateStatus: "error",
      error: "upstream unavailable",
    });
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
      calls.push([String(url), options]);
      if (String(url) !== "/api/dynamic-beta/admin?token=admin-token") {
        throw new Error(`Unexpected request: ${url}`);
      }
      if (responseMode === "transient") {
        return Response.json({ error: "Redis unavailable." }, { status: 500 });
      }
      if (responseMode === "malformed") {
        return Response.json({ configured: true });
      }
      if (responseMode === "denied") {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (responseMode === "gate") {
        return Response.json({ enabled: false, error: "Dynamic Beta data module 未啟用。" }, {
          status: 404,
        });
      }
      return Response.json({ configured: true, enabled: true, series: [delayed, fresh, never, error] });
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    let authorizationLosses = 0;

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(MarketDataAdminSection, {
          onAuthorizationLoss() { authorizationLosses += 1; },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      assert.deepEqual(calls.map(([url]) => url), [
        "/api/dynamic-beta/admin?token=admin-token",
      ]);
      assert.deepEqual(
        renderer.root.findAllByType("button").map((button) => renderedText(button)),
        ["重新整理", "手動同步"],
      );
      const summary = renderer.root.findByProps({ "aria-label": "市場資料新鮮度摘要" });
      assert.match(renderedText(summary), /新鮮\s*1/);
      assert.match(renderedText(summary), /延遲\s*1/);
      assert.match(renderedText(summary), /過期\s*0/);
      assert.match(renderedText(summary), /無資料\s*1/);
      assert.match(renderedText(summary), /同步失敗\s*1/);

      const sectionText = renderedText(renderer);
      assert.ok(sectionText.indexOf("ERROR") < sectionText.indexOf("NEVER"));
      assert.ok(sectionText.indexOf("NEVER") < sectionText.indexOf("DELAYED"));
      assert.ok(sectionText.indexOf("DELAYED") < sectionText.indexOf("所有正常資料"));
      assert.ok(sectionText.indexOf("所有正常資料") < sectionText.indexOf("FRESH"));
      assert.match(sectionText, /沒有資料/);
      assert.match(sectionText, /尚未同步/);
      assert.match(sectionText, /來源未提供 released\/vintage/);
      const normalDisclosure = renderer.root.findByProps({
        "aria-label": "所有正常資料",
      });
      assert.equal(normalDisclosure.type, "details");
      assert.equal(normalDisclosure.props.open, undefined);
      const tableScroll = normalDisclosure.findByProps({ className: "adminWideTableScroll" });
      const table = tableScroll.findByType("table");
      assert.match(renderedText(table.findByType("caption")), /市場資料明細/);
      assert.equal(table.findAllByType("thead").length, 1);
      assert.equal(table.findAllByType("tbody").length, 1);
      assert.equal(table.findByType("thead").findAllByType("th").length, 8);
      assert.ok(table.findByType("thead").findAllByType("th").every((header) => (
        header.props.scope === "col"
      )));
      assert.ok(table.findByType("tbody").findAllByType("th").every((header) => (
        header.props.scope === "row"
      )));

      responseMode = "transient";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "重新整理").props.onClick();
        await nextTurn();
      });
      const retainedText = renderedText(renderer);
      assert.match(retainedText, /Redis unavailable\./);
      assert.match(retainedText, /顯示上次成功讀取結果/);
      assert.match(retainedText, /Failed series/);
      assert.match(retainedText, /Fresh series/);

      responseMode = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "重新整理").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /市場資料.*回應格式無效/);
      assert.match(renderedText(renderer), /顯示上次成功讀取結果/);
      assert.match(renderedText(renderer), /Fresh series/);

      responseMode = "denied";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "重新整理").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /unauthorized/);
      assert.doesNotMatch(renderedText(renderer), /Fresh series|Failed series/);
      assert.equal(renderer.root.findAllByProps({
        "aria-label": "市場資料新鮮度摘要",
      }).length, 0);
      assert.doesNotMatch(renderedText(renderer), /顯示上次成功讀取結果/);
      assert.equal(authorizationLosses, 1);

      responseMode = "gate";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "重新整理").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /未啟用/);
      assert.doesNotMatch(renderedText(renderer), /Fresh series|Failed series/);
      assert.equal(authorizationLosses, 1);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutation caught: changing the existing sync route, method, JSON body, or omitting refresh.
  it("posts the existing manual-sync request and refreshes only market data", async () => {
    const MarketDataAdminSection = await loadMarketDataAdminSection();
    const fresh = seriesFixture("FRESH", "fresh");
    const calls = [];
    const scheduled = [];
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=a b" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      calls.push([String(url), options]);
      if (String(url).includes("/sync")) {
        return Response.json({
          status: "partial",
          results: [{ seriesId: "FRESH", status: "success" }, { seriesId: "FAIL", status: "error" }],
        });
      }
      if (String(url).includes("/admin")) {
        return Response.json({ configured: true, enabled: true, series: [fresh] });
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
        renderer = TestRenderer.create(React.createElement(MarketDataAdminSection));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      calls.length = 0;

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "手動同步").props.onClick();
        await nextTurn();
      });

      assert.deepEqual(calls.map(([url]) => url), [
        "/api/dynamic-beta/sync?token=a%20b",
        "/api/dynamic-beta/admin?token=a%20b",
      ]);
      assert.deepEqual(calls[0][1], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      assert.deepEqual(calls[1][1], { cache: "no-store" });
      assert.match(renderedText(renderer), /同步完成：2 個 series，1 個失敗。/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("settles a stale market sync and clears retained data when draft GET loses authorization", async () => {
    const MarketDataAdminSection = await loadMarketDataAdminSection();
    const scheduled = [];
    const delayedMarket = deferred();
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
    globalThis.fetch = async (url) => {
      if (String(url).includes("/api/dynamic-beta/sync?")) return delayedMarket.promise;
      if (String(url).includes("/api/dynamic-beta/admin?")) {
        return Response.json({ series: [seriesFixture("CURRENT", "fresh")] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const adminAccess = createDraftPanelController({
      fetchImpl: async () => Response.json(
        { error: "draft authorization expired" },
        { status: 401 },
      ),
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(MarketDataAdminSection, {
          adminAccess,
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /CURRENT name/);

      await TestRenderer.act(async () => {
        buttonByText(renderer, "手動同步").props.onClick();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        await assert.rejects(adminAccess.load({ token: "admin-token" }));
        await nextTurn();
      });

      const section = renderer.root.findByProps({ "aria-labelledby": "market-data-title" });
      assert.equal(section.props["aria-busy"], false);
      assert.doesNotMatch(renderedText(renderer), /CURRENT name|顯示上次成功讀取結果/);
      assert.equal(buttonByText(renderer, "重新整理").props.disabled, false);
      assert.equal(buttonByText(renderer, "手動同步").props.disabled, false);

      delayedMarket.resolve(Response.json({
        results: [{ seriesId: "OLD-EPOCH", status: "success" }],
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
