import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPositionGroups,
} from "../src/lib/position-settings.js";

describe("position settings helpers", () => {
  it("groups holdings into leveraged and original sections by asset beta", () => {
    const positions = [
      { id: "tw-2x", assetBeta: 2 },
      { id: "qqq", assetBeta: 1 },
      { id: "tw-2x-b", assetBeta: 2 },
    ];

    assert.deepEqual(getPositionGroups(positions), {
      leveraged: [positions[0], positions[2]],
      original: [positions[1]],
    });
  });
});
