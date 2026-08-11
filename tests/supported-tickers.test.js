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

  it("includes every approved ETF with its verified display name", () => {
    const byTicker = new Map(registry.map((item) => [item.ticker, item.name]));
    const approvedNames = {
      "0051": "元大中型100",
      "0052": "富邦科技",
      "0053": "元大電子",
      "0057": "富邦摩台",
      "006203": "元大MSCI台灣",
      "006204": "永豐臺灣加權",
      "00646": "元大S&P500",
      "00647L": "元大S&P500正2",
      "00661": "元大日經225",
      "00668": "國泰美國道瓊",
      "00670L": "富邦NASDAQ正2",
      "00692": "富邦公司治理",
      "00733": "富邦臺灣中小",
      "00757": "統一FANG+",
      "00830": "國泰費城半導體",
      "00850": "元大臺灣ESG永續",
      "00881": "國泰台灣科技龍頭",
      "00891": "中信關鍵半導體",
      "00892": "富邦台灣半導體",
      "00922": "國泰台灣領袖50",
      "00923": "群益台ESG低碳50",
      "00924": "復華S&P500成長",
      "00935": "野村臺灣新科技50",
      BIL: "State Street SPDR Bloomberg 1-3 Month T-Bill ETF",
      IVV: "iShares Core S&P 500 ETF",
      QQQM: "Invesco NASDAQ 100 ETF",
      SHV: "iShares 0-1 Year Treasury Bond ETF",
      SPUU: "Direxion Daily S&P 500 Bull 2X ETF",
      SPY: "SPDR S&P 500 ETF Trust",
      TFLO: "iShares Treasury Floating Rate Bond ETF",
      USFR: "WisdomTree Floating Rate Treasury Fund",
      VT: "Vanguard Total World Stock ETF",
      VTI: "Vanguard Total Stock Market ETF",
    };

    assert.deepEqual(
      Object.fromEntries(Object.keys(approvedNames).map((ticker) => [ticker, byTicker.get(ticker)])),
      approvedNames,
    );
  });

  it("generates the human-readable maintenance document from the registry", () => {
    const markdown = generateSupportedTickersMarkdown(registry);
    assert.match(markdown, /# 完整支援標的清單/);
    assert.match(markdown, /\| 009816 \| 凱基台灣TOP50 \| TWSE \|/);
    assert.match(markdown, /\| 00859B \| 群益0-1年美債 \| TPEx \|/);
    assert.match(markdown, /pnpm docs:supported-tickers/);
  });
});
