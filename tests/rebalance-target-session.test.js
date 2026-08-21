import test from "node:test";
import assert from "node:assert/strict";

import {
  REBALANCE_TARGET_RESET_AFTER_MS,
  shouldResetTemporaryRebalanceTarget,
} from "../src/lib/rebalance-target-session.js";

test("keeps the temporary rebalance target before 30 minutes of inactivity", () => {
  assert.equal(
    shouldResetTemporaryRebalanceTarget({
      inactiveSince: 1_000,
      now: 1_000 + REBALANCE_TARGET_RESET_AFTER_MS - 1,
    }),
    false,
  );
});

test("resets the temporary rebalance target after 30 minutes of inactivity", () => {
  assert.equal(
    shouldResetTemporaryRebalanceTarget({
      inactiveSince: 1_000,
      now: 1_000 + 30 * 60 * 1_000,
    }),
    true,
  );
});

test("does not expire a target when no inactivity period was recorded", () => {
  assert.equal(
    shouldResetTemporaryRebalanceTarget({
      inactiveSince: null,
      now: 30 * 60 * 1_000,
    }),
    false,
  );
});
