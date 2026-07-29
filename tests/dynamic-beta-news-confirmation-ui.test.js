import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  confirmationLabel,
  formatConfirmationMove,
  formatConfirmationObservation,
  formatRuleExpectation,
  persistenceLabel,
} from "../src/lib/dynamic-beta/news/confirmation-view.js";

describe("dynamic beta news confirmation admin UI", () => {
  it("translates every internal state without changing its meaning", () => {
    assert.equal(confirmationLabel("confirmed"), "已確認");
    assert.equal(confirmationLabel("reverse"), "反向");
    assert.equal(confirmationLabel("unconfirmed"), "未確認");
    assert.equal(confirmationLabel("observing"), "觀察中");
    assert.equal(confirmationLabel("insufficient_data"), "資料不足");
    assert.equal(confirmationLabel("not_configured"), "尚未設定確認規則");
    assert.equal(persistenceLabel("emerged_late"), "延後確認");
  });

  it("formats units and missing observations for the evidence table", () => {
    assert.equal(formatConfirmationMove(-1.23456, "percent"), "-1.23%");
    assert.equal(formatConfirmationMove(7.891, "basis_points"), "7.89 bps");
    assert.equal(formatConfirmationMove(null, "absolute"), "—");
    assert.equal(
      formatConfirmationObservation({ observationDate: "2026-07-27", value: 4.37 }),
      "4.37 · 2026-07-27",
    );
    assert.equal(formatConfirmationObservation(null), "—");
    assert.equal(formatRuleExpectation({
      expectedDirection: "down",
      threshold: 2,
      changeType: "percent",
    }), "下跌至少 2%");
  });
});
