import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OverviewCardHeader } from "../src/components/overview-card-header.js";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("overview card header", () => {
  it("renders a title, subtitle, accessible info control, and optional action", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OverviewCardHeader, {
        title: "市場水位",
        subtitle: "0050 距歷史高點",
        infoLabel: "查看市場水位說明",
        onInfo: () => {},
        action: React.createElement("button", { type: "button" }, "看全部曲線"),
      }),
    );

    assert.match(markup, /<h2>市場水位<\/h2>/);
    assert.match(markup, /0050 距歷史高點/);
    assert.match(markup, /aria-label="查看市場水位說明"/);
    assert.match(markup, />看全部曲線<\/button>/);
  });

  it("does not render an empty action region when a card has no action", () => {
    const markup = renderToStaticMarkup(
      React.createElement(OverviewCardHeader, {
        title: "資產配置比例",
        infoLabel: "查看資產配置說明",
        onInfo: () => {},
      }),
    );

    assert.doesNotMatch(markup, /overviewCardHeaderAction/);
  });

  it("connects all three overview cards to the shared header", () => {
    assert.equal(pageSource.match(/<OverviewCardHeader/g)?.length, 3);
    assert.match(
      pageSource,
      /title="目前 Beta"[\s\S]*?subtitle="整體資產曝險程度"/,
    );
  });

  it("uses the confirmed compact title and control sizes", () => {
    assert.match(cssSource, /\.overviewCardHeaderTitle\s*\{[^}]*font-size:\s*18px;/s);
    assert.match(
      cssSource,
      /\.overviewCardSubtitle\s*\{[^}]*color:\s*var\(--muted\);[^}]*font-size:\s*13px;/s,
    );
    assert.match(cssSource, /\.overviewCardInfoButton::after\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    assert.match(cssSource, /\.overviewCardAction\s*\{[^}]*height:\s*32px;[^}]*font-size:\s*11px;/s);
  });

  it("moves all overview info controls closer to their titles", () => {
    assert.match(
      cssSource,
      /\.overviewCardInfoButton\s*\{[^}]*margin:\s*-4px 0 -4px -8px;/s,
    );
  });

  it("matches the beta header spacing to the market card", () => {
    assert.match(
      cssSource,
      /\.betaCard > \.overviewCardHeader\s*\{[^}]*margin-bottom:\s*4px;/s,
    );
  });

  it("removes the visible market card border and retired market action", () => {
    assert.match(
      cssSource,
      /\.marketLevelCard\s*\{[^}]*border-color:\s*transparent;/s,
    );
    assert.doesNotMatch(cssSource, /\.marketLevelViewButton/);
  });

  it("uses the same inline inset for every overview card header", () => {
    assert.match(
      cssSource,
      /\.appCard\s*\{[^}]*--app-card-inline-padding:\s*20px;/s,
    );
    assert.match(
      cssSource,
      /\.marketLevelHeader\s*\{[^}]*padding:\s*12px var\(--app-card-inline-padding\) 0;/s,
    );
    assert.match(
      cssSource,
      /@media \(max-width: 480px\)[\s\S]*?\.appCard\s*\{[^}]*--app-card-inline-padding:\s*15px;/s,
    );
    assert.match(
      cssSource,
      /@media \(max-width: 760px\)[\s\S]*?\.marketLevelCard\s*\{[^}]*padding:\s*0;/s,
    );
  });

  it("gives the beta and market actions the same left edge", () => {
    assert.match(
      cssSource,
      /\.overviewCardAction\s*\{[^}]*width:\s*96px;/s,
    );
  });
});
