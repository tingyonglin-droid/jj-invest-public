import assert from "node:assert/strict";
import test from "node:test";

import {
  isQuoteableTickerInput,
  normalizeLegacyGhostPosition,
} from "../src/lib/stored-state.js";

test("repairs a legacy zero-valued empty holding", () => {
  assert.deepEqual(
    normalizeLegacyGhostPosition({
      id: "legacy-original",
      tickerInput: "0",
      shares: 0,
      assetBeta: 0,
      targetWeightPct: 0,
    }),
    {
      id: "legacy-original",
      tickerInput: "",
      shares: 0,
      assetBeta: 1,
      targetWeightPct: 0,
    },
  );
});

test("preserves funded holdings for explicit user correction", () => {
  const position = { tickerInput: "0", shares: 10, assetBeta: 0 };
  assert.deepEqual(normalizeLegacyGhostPosition(position), position);
});

test("does not send blank or zero ticker placeholders for quotes", () => {
  assert.equal(isQuoteableTickerInput(""), false);
  assert.equal(isQuoteableTickerInput(" 0 "), false);
  assert.equal(isQuoteableTickerInput("00631L"), true);
});
