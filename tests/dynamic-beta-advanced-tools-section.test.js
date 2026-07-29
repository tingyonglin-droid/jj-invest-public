import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import { createDraftPanelController } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

async function loadAdvancedToolsSection() {
  const fileUrl = new URL(
    "../app/admin/dynamic-beta/AdvancedToolsSection.js",
    import.meta.url,
  );
  let source = await readFile(fileUrl, "utf8");
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const adminViewUrl = new URL(
    "../src/lib/dynamic-beta/admin-view.js",
    import.meta.url,
  ).href;
  const templateUrl = new URL(
    "../src/lib/dynamic-beta/news/template.js",
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
      'from "../../../src/lib/dynamic-beta/news/template.js";',
      `from "${templateUrl}";`,
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
    renderedText(button).includes(text)
  ));
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function responseForFlags(url) {
  if (url.startsWith("/api/dynamic-beta/admin?")) {
    return Response.json({
      configured: true,
      enabled: true,
      flags: { dataEnabled: true, scoringEnabled: false, publicEnabled: false },
      series: [],
    });
  }
  if (url.startsWith("/api/dynamic-beta/news?")) {
    return Response.json({
      configured: true,
      flags: { dataEnabled: true, scoringEnabled: false, publicEnabled: false },
      briefs: [],
      evidence: [],
    });
  }
  throw new Error(`Unexpected request: ${url}`);
}

function scorePreviewFixture() {
  return {
    modelVersion: "market-risk-v0-test",
    asOf: "2026-07-24",
    mode: "offline-preview",
    historyQuality: "partial_history",
    status: "partial",
    expectedWeight: 1,
    rawCoverage: 0.75,
    coverage: 0.75,
    score: 72,
    categories: [{
      id: "volatility",
      score: 70,
      weight: 0.3,
      availableWeight: 0.3,
    }],
    signals: [{
      id: "vix_level",
      name: "VIX level",
      category: "volatility",
      reason: "Available observation.",
      value: 18.2,
      score: 70,
      weight: 0.15,
      observationDate: "2026-07-23",
      comparisonDate: null,
      seriesIds: ["VIXCLS"],
      actualSeriesIds: ["VIXCLS"],
      thresholds: [20, 30],
      direction: "higher-is-riskier",
      available: true,
    }],
    catalogSize: 18,
    dataSources: {
      VIXCLS: {
        requestedSeriesId: "VIXCLS",
        actualSeriesId: "VIXCLS",
        usedFallback: false,
        freshness: { status: "fresh" },
      },
    },
  };
}

function validationResultFixture() {
  return {
    valid: true,
    errors: [],
    warnings: ["review source timestamp"],
    value: {
      briefDate: "2026-07-24",
      generatedAt: "2026-07-24T08:00:00.000Z",
      analystLabel: "risk_elevated",
      analystRationale: null,
      evidence: [],
      events: [],
    },
    flags: { dataEnabled: true, scoringEnabled: false, publicEnabled: false },
  };
}

function savedResultFixture() {
  return {
    saved: true,
    valid: true,
    errors: [],
    warnings: [],
    dedupeWarnings: [],
    evidence: [],
    brief: { revisionId: "nbr_20260724_r3", revisionNumber: 3 },
  };
}

describe("AdvancedToolsSection", () => {
  // Mutations caught: fetching from module scope or another section, opening either
  // long tool by default, dropping a flag, or calling a draft lifecycle endpoint.
  it("loads only its authenticated flag diagnostics after mount and keeps both tools closed", async () => {
    const calls = [];
    const scheduled = [];
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=a b&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      calls.push([String(url), options]);
      return responseForFlags(String(url));
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      assert.deepEqual(calls, []);
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      assert.deepEqual(calls, []);

      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection));
      });
      assert.deepEqual(calls, []);

      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      assert.deepEqual(calls, [
        ["/api/dynamic-beta/admin?token=a%20b", { cache: "no-store" }],
        ["/api/dynamic-beta/news?token=a%20b", { cache: "no-store" }],
      ]);
      assert.ok(calls.every(([url]) => !/drafts\/(approve|reject)|\/publish/.test(url)));
      const text = renderedText(renderer);
      assert.match(text, /內部限定/);
      assert.match(text, /不影響 Target Beta/);
      assert.match(text, /Dynamic Beta data\s*啟用/);
      assert.match(text, /Dynamic Beta scoring\s*關閉/);
      assert.match(text, /Dynamic Beta public\s*關閉/);
      assert.match(text, /News data\s*啟用/);
      assert.match(text, /News scoring\s*關閉/);
      assert.match(text, /News public\s*關閉/);
      assert.match(text, /point-in-time/);
      const disclosures = renderer.root.findAllByType("details");
      assert.equal(disclosures.length, 2);
      assert.ok(disclosures.every((details) => details.props.open === undefined));
      assert.match(renderedText(disclosures[0].findByType("summary")), /Market Risk Score v0/);
      assert.match(renderedText(disclosures[1].findByType("summary")), /News Event JSON/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: using a shared page error, clearing a successful preview,
  // changing the selected-date query contract, or rendering known missing values as em dashes.
  it("owns the selected score date and preserves a prior preview when a later score request fails", async () => {
    const calls = [];
    const scheduled = [];
    let scoreAttempts = 0;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=a b&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      calls.push([requestUrl, options]);
      if (!requestUrl.startsWith("/api/dynamic-beta/score-preview?")) {
        return responseForFlags(requestUrl);
      }
      scoreAttempts += 1;
      if (scoreAttempts === 2) {
        return Response.json({ error: "score backend unavailable" }, { status: 500 });
      }
      return Response.json({
        score: 72,
        status: "partial",
        coverage: 0.75,
        modelVersion: "market-risk-v0-test",
        historyQuality: "partial_history",
        categories: [{
          id: "volatility",
          score: null,
          weight: 0.3,
          availableWeight: 0.15,
        }],
        signals: [{
          id: "vix_level",
          name: "VIX level",
          reason: "No usable observation.",
          value: null,
          score: null,
          weight: 0.15,
          observationDate: null,
          actualSeriesIds: [null],
        }],
      });
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      const dateInput = renderer.root.findByProps({ type: "date" });
      await TestRenderer.act(async () => {
        dateInput.props.onChange({ target: { value: "2026-07-24" } });
      });
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });

      assert.deepEqual(calls.at(-1), [
        "/api/dynamic-beta/score-preview?token=a%20b&date=2026-07-24",
        { cache: "no-store" },
      ]);
      const scoreDisclosure = renderer.root.findAllByType("details")[0];
      const successfulText = renderedText(scoreDisclosure);
      assert.match(successfulText, /總分：\s*72 \/ 100/);
      assert.match(successfulText, /market-risk-v0-test/);
      assert.match(successfulText, /資料不足/);
      assert.match(successfulText, /不適用/);
      assert.doesNotMatch(successfulText, /—/);

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });

      const retainedText = renderedText(renderer.root.findAllByType("details")[0]);
      assert.match(retainedText, /score backend unavailable/);
      assert.match(retainedText, /顯示上次成功計算結果/);
      assert.match(retainedText, /總分：\s*72 \/ 100/);
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);
      assert.doesNotMatch(renderedText(renderer), /News Event data 處理失敗/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: coupling flag and JSON errors, clearing either prior success,
  // parsing/reformatting the submitted body, or using draft lifecycle/save endpoints.
  it("keeps flag and raw-JSON outcomes independent while preserving each prior success", async () => {
    const calls = [];
    const scheduled = [];
    let failFlagRefresh = false;
    let validationAttempts = 0;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      calls.push([requestUrl, options]);
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news/validate?")) {
        validationAttempts += 1;
        if (validationAttempts === 2) {
          return Response.json({ error: "validator unavailable" }, { status: 500 });
        }
        return Response.json({
          saved: false,
          valid: true,
          errors: [],
          warnings: ["review source timestamp"],
        });
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        return Response.json({
          saved: true,
          valid: true,
          errors: [],
          warnings: [],
          brief: { revisionNumber: 3 },
        });
      }
      if (failFlagRefresh && options.method === undefined) {
        return Response.json({ error: "flag status unavailable" }, { status: 500 });
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      failFlagRefresh = true;
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      const flagFailureText = renderedText(renderer);
      assert.match(flagFailureText, /flag status unavailable/);
      assert.match(flagFailureText, /顯示上次成功讀取的功能狀態/);
      assert.match(flagFailureText, /Dynamic Beta data\s*啟用/);
      assert.match(flagFailureText, /News public\s*關閉/);

      const textarea = renderer.root.findByProps({ "aria-label": "Morning brief JSON" });
      const template = JSON.parse(textarea.props.value);
      assert.equal(template.events.length, 5);
      const rawJson = '{\n  "briefDate": "2026-07-24",\n  "events": []\n}';
      await TestRenderer.act(async () => {
        textarea.props.onChange({ target: { value: rawJson } });
      });
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });

      assert.deepEqual(calls.at(-1), [
        "/api/dynamic-beta/news/validate?token=admin-token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: rawJson,
        },
      ]);
      assert.match(renderedText(renderer), /格式驗證通過，尚未寫入/);
      assert.match(renderedText(renderer), /review source timestamp/);

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      const retainedValidationText = renderedText(renderer);
      assert.match(retainedValidationText, /validator unavailable/);
      assert.match(retainedValidationText, /顯示上次成功的 JSON 處理結果/);
      assert.match(retainedValidationText, /格式驗證通過，尚未寫入/);
      assert.match(retainedValidationText, /Dynamic Beta data\s*啟用/);

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.deepEqual(calls.at(-1), [
        "/api/dynamic-beta/news?token=admin-token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: rawJson,
        },
      ]);
      assert.match(renderedText(renderer), /已儲存 revision #3/);
      assert.ok(calls.every(([url]) => !/drafts\/(approve|reject)|\/publish/.test(url)));

      await TestRenderer.act(async () => {
        buttonByText(renderer, "重設範本").props.onClick();
      });
      assert.equal(
        JSON.parse(renderer.root.findByProps({ "aria-label": "Morning brief JSON" }).props.value)
          .events.length,
        5,
      );
      assert.doesNotMatch(renderedText(renderer), /已儲存 revision #3/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: settling only fetch (not response decoding), committing flags
  // only when every decoder succeeds, exposing parser details, or leaving refresh busy.
  it("keeps a valid peer flag update when the other status response is malformed", async () => {
    const scheduled = [];
    let refresh = false;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (!refresh) return responseForFlags(requestUrl);
      if (requestUrl.startsWith("/api/dynamic-beta/admin?")) {
        return Response.json({
          configured: true,
          enabled: true,
          flags: {
            dataEnabled: false,
            scoringEnabled: false,
            publicEnabled: false,
          },
          series: [],
        });
      }
      if (requestUrl.startsWith("/api/dynamic-beta/news?")) {
        return {
          ok: true,
          async json() {
            throw new SyntaxError("raw-secret-body is not valid JSON");
          },
        };
      }
      throw new Error(`Unexpected request: ${requestUrl}`);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);
      assert.match(renderedText(renderer), /News data\s*啟用/);

      refresh = true;
      let escapedError = null;
      await TestRenderer.act(async () => {
        try {
          await buttonByText(renderer, "更新功能狀態").props.onClick();
        } catch (error) {
          escapedError = error;
        }
        await nextTurn();
      });

      const text = renderedText(renderer);
      assert.match(text, /Dynamic Beta data\s*關閉/);
      assert.match(text, /News data\s*啟用/);
      assert.match(text, /News Event 功能狀態回應格式無效/);
      assert.match(text, /顯示上次成功讀取的功能狀態/);
      assert.doesNotMatch(text, /raw-secret-body/);
      assert.equal(escapedError, null);
      assert.equal(buttonByText(renderer, "更新功能狀態").props.disabled, false);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: treating malformed/gated flag responses as generic stale
  // failures, clearing a healthy peer feature, or propagating a feature gate as
  // a workspace-wide authorization loss.
  it("retains malformed and transient flags but clears only the gated flag feature", async () => {
    const scheduled = [];
    let marketMode = "success";
    let authorizationLosses = 0;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (!requestUrl.startsWith("/api/dynamic-beta/admin?")) {
        return responseForFlags(requestUrl);
      }
      if (marketMode === "malformed") return Response.json({ configured: true });
      if (marketMode === "transient") {
        return Response.json({ error: "flag service unavailable" }, { status: 503 });
      }
      if (marketMode === "gate") {
        return Response.json({ enabled: false, error: "Dynamic Beta data module 未啟用。" }, {
          status: 404,
        });
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
          onAuthorizationLoss() {
            authorizationLosses += 1;
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);

      marketMode = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Dynamic Beta 功能狀態.*回應格式無效/);
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);
      assert.match(renderedText(renderer), /顯示上次成功讀取的功能狀態/);

      marketMode = "transient";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /flag service unavailable/);
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);

      marketMode = "gate";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      const gatedText = renderedText(renderer);
      assert.match(gatedText, /Dynamic Beta data module 未啟用/);
      assert.match(gatedText, /Dynamic Beta data\s*尚未讀取/);
      assert.match(gatedText, /Dynamic Beta scoring\s*尚未讀取/);
      assert.match(gatedText, /Dynamic Beta public\s*尚未讀取/);
      assert.match(gatedText, /News data\s*啟用/);
      assert.equal(buttonByText(renderer, "更新功能狀態").props.disabled, false);
      assert.equal(buttonByText(renderer, "計算 Preview").props.disabled, false);
      assert.equal(authorizationLosses, 0);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: accepting an empty 2xx payload as a preview/validation,
  // clearing validated stale state for transient failures, or letting one feature
  // gate clear retained state owned by another feature.
  it("validates score and JSON responses while scoping feature gates", async () => {
    const scheduled = [];
    let scoreMode = "success";
    let validateMode = "success";
    let saveMode = "success";
    let authorizationLosses = 0;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("/api/dynamic-beta/score-preview?")) {
        if (scoreMode === "malformed") return Response.json({});
        if (scoreMode === "transient") {
          return Response.json({ error: "score backend unavailable" }, { status: 500 });
        }
        if (scoreMode === "gate") {
          return Response.json({ enabled: false, error: "Score preview 未啟用。" }, {
            status: 404,
          });
        }
        return Response.json(scorePreviewFixture());
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news/validate?")) {
        if (validateMode === "malformed") return Response.json({});
        if (validateMode === "invalid") {
          return Response.json({
            valid: false,
            errors: ["晨報必須剛好包含 5 則事件。"],
            warnings: ["請重新檢查來源時間。"],
          }, { status: 400 });
        }
        if (validateMode === "transient") {
          return Response.json({ error: "validator unavailable" }, { status: 503 });
        }
        if (validateMode === "gate") {
          return Response.json({ enabled: false, error: "News validation 未啟用。" }, {
            status: 404,
          });
        }
        return Response.json(validationResultFixture());
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        if (saveMode === "malformed") return Response.json({});
        if (saveMode === "invalid") {
          return Response.json({
            saved: false,
            valid: false,
            errors: ["儲存前必須修正事件排名。"],
            warnings: [],
          }, { status: 400 });
        }
        return Response.json(savedResultFixture());
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
          onAuthorizationLoss() {
            authorizationLosses += 1;
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100/);
      assert.match(renderedText(renderer), /格式驗證通過，尚未寫入/);

      scoreMode = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Score preview.*回應格式無效/);
      assert.match(renderedText(renderer), /顯示上次成功計算結果/);
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100/);

      scoreMode = "transient";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /score backend unavailable/);
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100/);

      scoreMode = "gate";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Score preview 未啟用/);
      assert.doesNotMatch(renderedText(renderer), /總分：\s*72 \/ 100/);
      assert.match(renderedText(renderer), /格式驗證通過，尚未寫入/);
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);
      assert.equal(buttonByText(renderer, "只驗證").props.disabled, false);

      scoreMode = "success";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });
      validateMode = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /News Event data.*回應格式無效/);
      assert.match(renderedText(renderer), /顯示上次成功的 JSON 處理結果/);
      assert.match(renderedText(renderer), /格式驗證通過，尚未寫入/);

      validateMode = "transient";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /validator unavailable/);
      assert.match(renderedText(renderer), /格式驗證通過，尚未寫入/);

      validateMode = "gate";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /News validation 未啟用/);
      assert.doesNotMatch(renderedText(renderer), /格式驗證通過，尚未寫入/);
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100/);
      assert.match(renderedText(renderer), /News data\s*啟用/);
      assert.equal(buttonByText(renderer, "驗證並儲存").props.disabled, false);

      await TestRenderer.act(async () => {
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /已儲存 revision #3/);
      saveMode = "malformed";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /News Event data.*回應格式無效/);
      assert.match(renderedText(renderer), /顯示上次成功的 JSON 處理結果/);
      assert.match(renderedText(renderer), /已儲存 revision #3/);

      validateMode = "invalid";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "只驗證").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /格式驗證失敗/);
      assert.match(renderedText(renderer), /晨報必須剛好包含 5 則事件/);
      assert.match(renderedText(renderer), /請重新檢查來源時間/);
      assert.doesNotMatch(renderedText(renderer), /格式驗證通過，尚未寫入/);
      assert.doesNotMatch(renderedText(renderer), /顯示上次成功的 JSON 處理結果/);

      saveMode = "invalid";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /格式驗證失敗/);
      assert.match(renderedText(renderer), /儲存前必須修正事件排名/);
      assert.doesNotMatch(renderedText(renderer), /已儲存 revision #3/);
      assert.doesNotMatch(renderedText(renderer), /顯示上次成功的 JSON 處理結果/);
      assert.equal(authorizationLosses, 0);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: treating 401/403 as a feature-local failure, retaining any
  // previously rendered internal result, leaving API actions enabled, or invoking
  // the page callback more than once for one denied request.
  it("globally clears and locks retained tools after authorization loss", async () => {
    const scheduled = [];
    let saveMode = "success";
    let newsMode = "success";
    let authorizationLosses = 0;
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("/api/dynamic-beta/score-preview?")) {
        return Response.json(scorePreviewFixture());
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        if (saveMode === "denied") {
          return Response.json({ error: "workspace authorization expired" }, { status: 403 });
        }
        return Response.json(savedResultFixture());
      }
      if (requestUrl.startsWith("/api/dynamic-beta/news?")) {
        if (newsMode === "denied") {
          return Response.json({ error: "workspace authorization expired" }, { status: 401 });
        }
        return responseForFlags(requestUrl);
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
          onAuthorizationLoss() {
            authorizationLosses += 1;
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /Dynamic Beta data\s*啟用/);
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100/);
      assert.match(renderedText(renderer), /已儲存 revision #3/);

      saveMode = "denied";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      const deniedText = renderedText(renderer);
      assert.match(deniedText, /workspace authorization expired/);
      assert.match(deniedText, /Dynamic Beta data\s*尚未讀取/);
      assert.match(deniedText, /News data\s*尚未讀取/);
      assert.doesNotMatch(deniedText, /總分：\s*72 \/ 100|已儲存 revision #3/);
      assert.doesNotMatch(deniedText, /顯示上次成功/);
      assert.equal(buttonByText(renderer, "更新功能狀態").props.disabled, false);
      for (const label of ["計算 Preview", "只驗證", "驗證並儲存"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, true);
      }
      assert.equal(authorizationLosses, 1);

      await TestRenderer.act(async () => renderer.unmount());
      renderer = null;
      saveMode = "success";
      newsMode = "denied";
      authorizationLosses = 0;
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
          onAuthorizationLoss() {
            authorizationLosses += 1;
          },
        }));
      });
      await TestRenderer.act(async () => {
        while (scheduled.length) scheduled.shift()();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /workspace authorization expired/);
      assert.equal(authorizationLosses, 1);
      assert.equal(buttonByText(renderer, "更新功能狀態").props.disabled, false);
      for (const label of ["計算 Preview", "只驗證", "驗證並儲存"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, true);
      }
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutations caught: allowing an earlier successful tool response to render after
  // a different Advanced request globally invalidated the shared workspace access.
  it("ignores an older score success after a concurrent flag request loses authorization", async () => {
    const scheduled = [];
    const delayedScore = deferred();
    let flagMode = "success";
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      clearTimeout() {},
    };
    globalThis.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("/api/dynamic-beta/score-preview?")) {
        return delayedScore.promise;
      }
      if (flagMode === "denied" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        return Response.json({ error: "workspace authorization expired" }, { status: 401 });
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    const adminAccess = createDraftPanelController({
      fetchImpl: async () => {
        throw new Error("Draft endpoint should not be called by Advanced tools.");
      },
      confirmImpl: () => true,
      promptImpl: () => "",
    });
    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
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

      let scoreRequest;
      await TestRenderer.act(async () => {
        scoreRequest = buttonByText(renderer, "計算 Preview").props.onClick();
        await nextTurn();
      });
      flagMode = "denied";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      assert.equal(adminAccess.getLifecycleSnapshot().phase, "access-denied");

      delayedScore.resolve(Response.json(scorePreviewFixture()));
      await TestRenderer.act(async () => {
        await scoreRequest;
        await nextTurn();
      });
      assert.doesNotMatch(renderedText(renderer), /總分：\s*72 \/ 100/);
      assert.equal(adminAccess.getLifecycleSnapshot().phase, "access-denied");
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("recovers after draft denial and rejects old success, failure, and authorization outcomes", async () => {
    const scheduled = [];
    const oldScore = deferred();
    const oldValidation = deferred();
    const oldMarketFlag = deferred();
    const oldNewsFlag = deferred();
    let scoreMode = "success";
    let validationMode = "success";
    let flagsMode = "success";
    let draftMode = "denied";
    const originalWindow = globalThis.window;
    const originalFetch = globalThis.fetch;
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.window = {
      location: { href: "https://example.test/admin/dynamic-beta?token=admin-token&section=more" },
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; },
      clearTimeout() {},
    };
    globalThis.fetch = async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.startsWith("/api/dynamic-beta/score-preview?")) {
        return scoreMode === "deferred" ? oldScore.promise : Response.json(scorePreviewFixture());
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news/validate?")) {
        return validationMode === "deferred"
          ? oldValidation.promise
          : Response.json({ valid: true, errors: [], warnings: [] });
      }
      if (options.method === "POST" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        return Response.json(savedResultFixture());
      }
      if (flagsMode === "deferred" && requestUrl.startsWith("/api/dynamic-beta/admin?")) {
        return oldMarketFlag.promise;
      }
      if (flagsMode === "deferred" && requestUrl.startsWith("/api/dynamic-beta/news?")) {
        return oldNewsFlag.promise;
      }
      return responseForFlags(requestUrl);
    };
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    const adminAccess = createDraftPanelController({
      fetchImpl: async () => (
        draftMode === "denied"
          ? Response.json({ error: "draft authorization expired" }, { status: 401 })
          : Response.json({ drafts: [] })
      ),
      confirmImpl: () => true,
      promptImpl: () => "",
    });

    let renderer;
    try {
      const AdvancedToolsSection = await loadAdvancedToolsSection();
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(AdvancedToolsSection, {
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
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "計算 Preview").props.onClick();
        await buttonByText(renderer, "驗證並儲存").props.onClick();
        await nextTurn();
      });
      assert.match(renderedText(renderer), /總分：\s*72 \/ 100|已儲存 revision #3/);

      scoreMode = "deferred";
      validationMode = "deferred";
      flagsMode = "deferred";
      let scoreRequest;
      let validationRequest;
      let flagsRequest;
      await TestRenderer.act(async () => {
        scoreRequest = buttonByText(renderer, "計算 Preview").props.onClick();
        validationRequest = buttonByText(renderer, "只驗證").props.onClick();
        flagsRequest = buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      await TestRenderer.act(async () => {
        await assert.rejects(adminAccess.load({ token: "admin-token" }));
        await nextTurn();
      });

      const deniedEpoch = adminAccess.getLifecycleSnapshot().accessEpoch;
      assert.equal(adminAccess.getLifecycleSnapshot().phase, "access-denied");
      assert.doesNotMatch(renderedText(renderer), /總分：\s*72 \/ 100|已儲存 revision #3/);
      assert.equal(buttonByText(renderer, "更新功能狀態").props.disabled, false);
      for (const label of ["計算 Preview", "只驗證", "驗證並儲存"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, true);
      }

      flagsMode = "success";
      await TestRenderer.act(async () => {
        await buttonByText(renderer, "更新功能狀態").props.onClick();
        await nextTurn();
      });
      assert.equal(adminAccess.getLifecycleSnapshot().phase, "idle");
      assert.equal(adminAccess.getLifecycleSnapshot().accessEpoch, deniedEpoch);
      for (const label of ["更新功能狀態", "計算 Preview", "只驗證", "驗證並儲存"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, false);
      }

      oldScore.resolve(Response.json({ ...scorePreviewFixture(), score: 11, modelVersion: "old-epoch" }));
      oldValidation.resolve(Response.json({ error: "old transient failure" }, { status: 503 }));
      oldMarketFlag.resolve(responseForFlags("/api/dynamic-beta/admin?token=admin-token"));
      oldNewsFlag.resolve(Response.json({ error: "old authorization failure" }, { status: 401 }));
      await TestRenderer.act(async () => {
        await Promise.all([scoreRequest, validationRequest, flagsRequest]);
        await nextTurn();
      });

      const finalText = renderedText(renderer);
      assert.doesNotMatch(finalText, /old-epoch|old transient failure|old authorization failure|總分：\s*11/);
      assert.equal(adminAccess.getLifecycleSnapshot().phase, "idle");
      assert.equal(adminAccess.getLifecycleSnapshot().accessEpoch, deniedEpoch);
      for (const label of ["更新功能狀態", "計算 Preview", "只驗證", "驗證並儲存"]) {
        assert.equal(buttonByText(renderer, label).props.disabled, false);
      }
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.fetch = originalFetch;
      globalThis.window = originalWindow;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });
});
