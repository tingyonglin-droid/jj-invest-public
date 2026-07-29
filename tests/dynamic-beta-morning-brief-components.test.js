import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import {
  buildPublishedBriefPresentation,
  formatBriefConfidence,
  knownMissingLabel,
} from "../src/lib/dynamic-beta/news/brief-presentation.js";
import { buildDraftPreview } from "../src/lib/dynamic-beta/news/draft-panel-controller.js";

const SOURCE_URL = "https://example.com/research/market-impact?series=YAHOO%3AQQQ&window=very-long-query-value";

function eventFixture(rank, overrides = {}) {
  return {
    rank,
    headline: `Event ${rank}`,
    summary: `Summary ${rank}`,
    evidenceUrls: [SOURCE_URL],
    topicIds: ["ai_semiconductors"],
    transmissionPath: ["earnings", "capital spending", "semiconductors"],
    affectedAssets: ["QQQ", "SOXX"],
    marketDate: "2026-07-28",
    dataToConfirm: ["YAHOO:QQQ"],
    confirmationRules: [{
      seriesId: "YAHOO:QQQ",
      expectedDirection: "down",
      changeType: "percent",
      threshold: 1.25,
    }],
    interpretation: `Interpretation ${rank}`,
    confidence: rank === 1 ? 0 : 0.8,
    techEarnings: rank === 1
      ? {
        company: "Example Cloud",
        revenueGrowthPct: 12.5,
        aiCloudGrowthPct: null,
        capexGrowthPct: 40,
        freeCashFlowGrowthPct: null,
        capexGrowingFasterThanFcf: null,
      }
      : null,
    ...overrides,
  };
}

function briefFixture(overrides = {}) {
  return {
    briefDate: "2026-07-28",
    revisionId: "nbr_published",
    revisionNumber: 4,
    generatedAt: "2026-07-28T00:00:00.000Z",
    analystLabel: "risk_elevated",
    analystRationale: "Waiting for confirmation.",
    evidence: [{
      evidenceId: "ev_primary",
      revisionId: "nev_primary_r1",
      originalUrl: "https://example.com/original",
      canonicalUrl: SOURCE_URL,
      title: "Primary research",
      summary: "Source summary.",
      sourceName: "Example Research",
      sourceTier: "primary",
      publishedAt: "2026-07-27T23:00:00.000Z",
      retrievedAt: "2026-07-28T00:00:00.000Z",
    }],
    events: [5, 3, 1, 4, 2].map((rank) => eventFixture(rank)),
    ...overrides,
  };
}

function draftFixture() {
  const payload = briefFixture();
  delete payload.revisionId;
  delete payload.revisionNumber;
  return {
    briefDate: payload.briefDate,
    draftRevisionId: "ndrv_draft",
    draftRevisionNumber: 3,
    status: "pending",
    createdAt: "2026-07-28T00:01:00.000Z",
    updatedAt: "2026-07-28T00:02:00.000Z",
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    approvedBriefRevisionId: null,
    approvedBriefRevisionNumber: null,
    validationWarnings: [],
    dedupeWarnings: [],
    payload,
  };
}

async function loadMorningBriefComponents() {
  const componentUrl = new URL(
    "../src/components/morning-brief/MorningBriefContent.js",
    import.meta.url,
  );
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const jsxRuntimeUrl = new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href;
  const presenterUrl = new URL(
    "../src/lib/dynamic-beta/news/brief-presentation.js",
    import.meta.url,
  ).href;
  const source = (await readFile(componentUrl, "utf8"))
    .replace('from "react";', `from "${reactUrl}";`)
    .replace(
      'from "../../lib/dynamic-beta/news/brief-presentation.js";',
      `from "${presenterUrl}";`,
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
  return import(moduleUrl);
}

function renderedText(renderer) {
  function visit(node) {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(visit).join(" ");
    return node?.children?.map(visit).join(" ") || "";
  }
  const value = typeof renderer.toJSON === "function" ? renderer.toJSON() : renderer;
  return visit(value).replace(/\s+/g, " ").trim();
}

describe("morning brief shared presentation", () => {
  // Mutation caught: sharing one ambiguous identity or sorting the caller-owned event array.
  it("normalizes draft and published records without losing ranked content", () => {
    const publishedInput = briefFixture();
    const originalRankOrder = publishedInput.events.map((event) => event.rank);
    const published = buildPublishedBriefPresentation(publishedInput);
    const draft = buildDraftPreview(draftFixture()).content;

    assert.deepEqual(published.identity, {
      kind: "published",
      briefDate: "2026-07-28",
      revisionId: "nbr_published",
      revisionNumber: 4,
      status: "published",
    });
    assert.deepEqual(draft.identity, {
      kind: "draft",
      briefDate: "2026-07-28",
      revisionId: "ndrv_draft",
      revisionNumber: 3,
      status: "pending",
    });
    assert.deepEqual(published.events.map((event) => event.rank), [1, 2, 3, 4, 5]);
    assert.deepEqual(draft.events.map((event) => event.rank), [1, 2, 3, 4, 5]);
    assert.deepEqual(publishedInput.events.map((event) => event.rank), originalRankOrder);

    assert.deepEqual(published.evidence[0], {
      evidenceId: "ev_primary",
      revisionId: "nev_primary_r1",
      originalUrl: "https://example.com/original",
      canonicalUrl: SOURCE_URL,
      url: SOURCE_URL,
      title: "Primary research",
      summary: "Source summary.",
      sourceName: "Example Research",
      sourceTier: "primary",
      publishedAt: "2026-07-27T23:00:00.000Z",
      retrievedAt: "2026-07-28T00:00:00.000Z",
    });
    assert.equal(
      JSON.stringify(published.events[0].confirmationRules),
      JSON.stringify(eventFixture(1).confirmationRules),
    );
    assert.equal(
      JSON.stringify(published.events[0].dataToConfirm),
      JSON.stringify(eventFixture(1).dataToConfirm),
    );
    assert.equal(published.events[0].confidence, 0);
    assert.equal(draft.events[0].confidence, 0);
  });

  it("uses explicit labels for zero and known missing values", () => {
    assert.equal(formatBriefConfidence(0), "0");
    assert.equal(formatBriefConfidence(null), "未提供信心");
    assert.equal(knownMissingLabel("technologyMetric"), "尚未公布");
    assert.equal(knownMissingLabel("confirmationRules"), "沒有設定規則");
    assert.equal(knownMissingLabel("technologyEarnings"), "非科技財報事件");
    assert.equal(knownMissingLabel("optional"), "未提供");
  });
});

describe("morning brief shared read-only components", () => {
  // Mutation caught: omitting complete-view evidence, analytical paths, or known missing labels.
  it("renders all decision evidence semantically and keeps links safe", async () => {
    const { default: MorningBriefContent } = await loadMorningBriefComponents();
    const brief = buildPublishedBriefPresentation(briefFixture({
      events: [
        eventFixture(1),
        eventFixture(2, { confirmationRules: [] }),
        eventFixture(3),
        eventFixture(4),
        eventFixture(5),
      ],
    }));
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(MorningBriefContent, { brief }));
      });
      const text = renderedText(renderer);
      assert.match(text, /Published Morning Brief/);
      assert.match(text, /Primary research/);
      assert.match(text, /ev_primary/);
      assert.match(text, /https:\/\/example\.com\/original/);
      assert.match(text, /ai_semiconductors/);
      assert.match(text, /earnings → capital spending → semiconductors/);
      assert.match(text, /QQQ\s*,\s*SOXX/);
      assert.match(text, /2026-07-28/);
      assert.match(text, /YAHOO:QQQ/);
      assert.match(text, /下跌至少 1\.25%/);
      assert.match(text, /Interpretation 1/);
      assert.match(text, /信心 0(?:\s|$)/);
      assert.match(text, /AI／雲端成長 尚未公布/);
      assert.match(text, /自由現金流成長 尚未公布/);
      assert.match(text, /CapEx 成長快於自由現金流 尚未公布/);
      assert.match(text, /沒有設定規則/);
      assert.match(text, /非科技財報事件/);
      assert.equal(renderer.root.findAllByType("details").length, 5);
      assert.ok(renderer.root.findAllByType("h3").length >= 5);
      assert.ok(renderer.root.findAllByType("ul").length > 0);
      const sourceLink = renderer.root.findAllByType("a").find((link) => (
        link.props.href === SOURCE_URL
      ));
      assert.equal(sourceLink.props.target, "_blank");
      assert.equal(sourceLink.props.rel, "noreferrer");
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("renders a compact five-headline summary without full event details", async () => {
    const { default: MorningBriefContent } = await loadMorningBriefComponents();
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };
    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(MorningBriefContent, {
          brief: buildPublishedBriefPresentation(briefFixture()),
          compact: true,
        }));
      });
      const text = renderedText(renderer);
      for (let rank = 1; rank <= 5; rank += 1) assert.match(text, new RegExp(`Event ${rank}`));
      assert.equal(renderer.root.findAllByType("details").length, 0);
      assert.doesNotMatch(text, /傳導路徑/);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  it("uses a caller-selected heading depth when embedded below workspace headings", async () => {
    const {
      ConfirmationSummary,
      default: MorningBriefContent,
    } = await loadMorningBriefComponents();
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(
          React.Fragment,
          null,
          React.createElement(MorningBriefContent, {
            brief: buildPublishedBriefPresentation(briefFixture()),
            headingLevel: 4,
          }),
          React.createElement(ConfirmationSummary, {
            summary: {
              d1: { status: "confirmed" },
              d3: { status: "observing" },
              persistence: "observing",
            },
            headingLevel: 3,
          }),
        ));
      });

      assert.equal(renderer.root.findAllByType("h2").length, 0);
      assert.equal(renderer.root.findAllByType("h3").length, 1);
      assert.match(renderedText(renderer.root.findByType("h3")), /市場確認摘要/);
      assert.ok(renderer.root.findAllByType("h4").length >= 3);
      assert.ok(renderer.root.findAllByType("h5").length >= 5);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });

  // Mutation caught: restoring literal section IDs shared by every brief instance.
  it("keeps section labeling instance-safe when two briefs render together", async () => {
    const { default: MorningBriefContent } = await loadMorningBriefComponents();
    const brief = buildPublishedBriefPresentation(briefFixture());
    const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    const originalConsoleError = console.error;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    console.error = (...args) => {
      if (String(args[0]).includes("react-test-renderer is deprecated")) return;
      originalConsoleError(...args);
    };

    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(
          React.Fragment,
          null,
          React.createElement(MorningBriefContent, { brief }),
          React.createElement(MorningBriefContent, { brief }),
        ));
      });
      const ids = renderer.root
        .findAll((node) => typeof node.props?.id === "string")
        .map((node) => node.props.id);
      const labelReferences = renderer.root
        .findAll((node) => typeof node.props?.["aria-labelledby"] === "string")
        .map((node) => node.props["aria-labelledby"]);

      assert.equal(new Set(ids).size, ids.length);
      assert.ok(labelReferences.every((reference) => ids.includes(reference)));
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
      console.error = originalConsoleError;
      globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    }
  });
});
