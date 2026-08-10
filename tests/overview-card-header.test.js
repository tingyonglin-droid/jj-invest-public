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
  });

  it("uses the confirmed compact title and control sizes", () => {
    assert.match(cssSource, /\.overviewCardHeaderTitle\s*\{[^}]*font-size:\s*16px;/s);
    assert.match(cssSource, /\.overviewCardInfoButton::after\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;/s);
    assert.match(cssSource, /\.overviewCardAction\s*\{[^}]*height:\s*32px;[^}]*font-size:\s*11px;/s);
  });
});
