import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Beta target emphasis UI", () => {
  it("uses the summary as guidance instead of duplicating the target input", () => {
    assert.match(pageSource, /className="weightGuardSummary"/);
    assert.match(pageSource, /先設定目標 Beta/);
    assert.match(pageSource, /依目前持股推算配置/);
    assert.doesNotMatch(pageSource, /className="weightGuardBeta"/);
  });

  it("uses the shared Morandi gray-green tone for the guidance summary", () => {
    assert.match(stylesSource, /\.weightGuard\.ok\s*\{[^}]*color:\s*var\(--primary-dark\);[^}]*background:\s*#edf0ec;/s);
    assert.match(stylesSource, /\.weightGuardSummary > span\s*\{[^}]*color:\s*rgba\(95, 108, 100, 0\.82\);/s);
  });
});
