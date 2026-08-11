import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("defines one Morandi palette for assets and actions", () => {
  assert.match(styles, /--asset-leveraged:\s*#9b8aa1;/i);
  assert.match(styles, /--asset-original:\s*#87988a;/i);
  assert.match(styles, /--asset-cash:\s*#8797a4;/i);
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
  assert.match(styles, /\.marketBand\.normal\s*\{[^}]*var\(--risk-normal\)/s);
  assert.match(styles, /\.marketBand\.prepare\s*\{[^}]*var\(--risk-prepare\)/s);
  assert.match(styles, /\.marketBand\.deep\s*\{[^}]*var\(--risk-deep\)/s);
  assert.match(styles, /\.bottomTabBar button\.active\s*\{[^}]*var\(--action-selected\)/s);
});
