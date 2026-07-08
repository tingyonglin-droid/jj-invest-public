import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAdviceActionText } from "../src/lib/advice-summary.js";

describe("advice summary helpers", () => {
  it("formats action and amount on one line", () => {
    assert.equal(
      createAdviceActionText({ label: "賣出", amount: "NT$1,777,866" }),
      "賣出 NT$1,777,866",
    );
  });

  it("omits the amount when there is no amount text", () => {
    assert.equal(
      createAdviceActionText({ label: "無需操作", amount: "" }),
      "無需操作",
    );
  });
});
