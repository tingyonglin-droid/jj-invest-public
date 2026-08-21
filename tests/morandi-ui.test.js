import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("defines one Morandi palette for assets and actions", () => {
  assert.match(styles, /--asset-leveraged:\s*#967c9d;/i);
  assert.match(styles, /--asset-original:\s*#78917e;/i);
  assert.match(styles, /--asset-cash:\s*#7891a5;/i);
  assert.match(styles, /--action-selected:\s*#ddd7cf;/i);
  assert.match(styles, /--action-remove:\s*#a07779;/i);
  assert.match(styles, /--action-valid:\s*#78867d;/i);
});

test("uses asset tones across settings and rebalance groups", () => {
  assert.match(styles, /\.positionSection\.leveraged/);
  assert.match(styles, /\.positionSection\.original/);
  assert.match(styles, /\.positionEditor\.cash/);
  assert.match(styles, /\.holdingGroup\.cash/);
  assert.match(page, /tone="cash"/);
});

test("uses restrained Morandi states on the overview", () => {
  assert.match(styles, /\.allocationLeveraged\s*\{[^}]*var\(--asset-leveraged\)/s);
  assert.match(styles, /\.allocationOriginal\s*\{[^}]*var\(--asset-original\)/s);
  assert.match(styles, /\.allocationCash\s*\{[^}]*var\(--asset-cash\)/s);
  assert.match(
    styles,
    /\.allocationBar > span \+ span\s*\{[^}]*box-shadow:\s*inset 2px 0 0 var\(--card\);/s,
  );
  assert.match(styles, /\.marketBand\.normal\s*\{[^}]*var\(--risk-normal\)/s);
  assert.match(styles, /\.marketBand\.prepare\s*\{[^}]*var\(--risk-prepare\)/s);
  assert.match(styles, /\.marketBand\.deep\s*\{[^}]*var\(--risk-deep\)/s);
  assert.match(styles, /\.bottomTabBar button\.active\s*\{[^}]*var\(--action-selected\)/s);
  assert.match(styles, /\.betaAction\.balanced\s*\{[^}]*background:\s*#eef1ee;/s);
  assert.match(styles, /\.betaAction\.rebalance\s*\{[^}]*color:\s*#963d35;[^}]*background:\s*#fde6e2;[^}]*font-size:\s*14px;/s);
});

test("public header uses the centered handwritten Betree wordmark", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const publicHeader = page.match(/function AppHeader\(\)[\s\S]*?\n}\n/)?.[0] ?? "";
  const sharedHeader = css.match(/\.appHeader\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(publicHeader, /className="betreeWordmark"[^>]*>\s*Betree\s*</);
  assert.match(publicHeader, /className="appHeader publicAppHeader"/);
  assert.doesNotMatch(publicHeader, /JJ Invest System|brandGlyph|曝險管理/);
  assert.match(layout, /Caveat\(\{[\s\S]*weight:\s*"600"/);
  assert.match(layout, /variable:\s*"--font-betree"/);
  assert.doesNotMatch(sharedHeader, /justify-content|min-height|height/);
  assert.match(css, /\.publicAppHeader\s*\{[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.publicAppHeader\s*\{[\s\S]*height:\s*28px/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*font-family:\s*var\(--font-betree\)/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*font-size:\s*40px/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*font-weight:\s*600/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*line-height:\s*28px/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*white-space:\s*nowrap/);
});
