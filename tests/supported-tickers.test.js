import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { generateSupportedTickersMarkdown } from "../scripts/generate-supported-tickers-doc.js";

const registry = JSON.parse(
  await readFile(new URL("../src/data/supported-tickers.json", import.meta.url), "utf8"),
);

describe("supported ticker registry", () => {
  it("contains complete, uniquely addressable ticker records", () => {
    assert.ok(Array.isArray(registry));
    assert.ok(registry.length >= 20);

    const symbols = [];
    registry.forEach((item) => {
      assert.match(item.ticker, /^[A-Z0-9]+$/);
      assert.ok(item.name.length > 0);
      assert.ok(["leveraged", "original", "cashEquivalent"].includes(item.category));
      assert.ok(["TWSE", "TPEx", "US"].includes(item.market));
      assert.ok(Array.isArray(item.symbols) && item.symbols.length > 0);
      assert.ok(Array.isArray(item.quoteSources) && item.quoteSources.length > 0);
      assert.equal(item.verified, true);
      assert.match(item.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
      symbols.push(...item.symbols);
    });

    assert.equal(new Set(symbols).size, symbols.length);
  });

  it("includes the verified cash-equivalent and Taiwan ETF aliases", () => {
    const byTicker = new Map(registry.map((item) => [item.ticker, item]));
    assert.deepEqual(byTicker.get("00859B").symbols, ["00859B.TW", "00859B.TWO"]);
    assert.deepEqual(byTicker.get("00864B").symbols, ["00864B.TW", "00864B.TWO"]);
    assert.equal(byTicker.get("009816").name, "凱基台灣TOP50");
    assert.equal(byTicker.get("USD").name, "ProShares Ultra Semiconductors");
  });

  it("generates the human-readable maintenance document from the registry", () => {
    const markdown = generateSupportedTickersMarkdown(registry);
    assert.match(markdown, /# 完整支援標的清單/);
    assert.match(markdown, /\| 009816 \| 凱基台灣TOP50 \| TWSE \|/);
    assert.match(markdown, /\| 00859B \| 群益0-1年美債 \| TPEx \|/);
    assert.match(markdown, /pnpm docs:supported-tickers/);
  });
});
