import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Beta target emphasis UI", () => {
  it("renders the target Beta with equal-size label and one-decimal value", () => {
    assert.match(pageSource, /className="weightGuardSummary"/);
    assert.match(pageSource, /className="weightGuardBeta"/);
    assert.match(pageSource, /className="weightGuardBetaLabel">目標Beta設定/);
    assert.match(pageSource, /className="weightGuardBetaValue"/);
    assert.match(pageSource, /formatNumber\(calculation\.targetBeta, 1\)/);
    assert.doesNotMatch(pageSource, /className="weightGuardBetaValue">[\s\S]*?≈/);
    assert.match(
      stylesSource,
      /\.weightGuardBetaLabel,\s*\.weightGuardBetaValue\s*\{[^}]*font-size:\s*clamp\(20px, 3vw, 26px\);/s,
    );
    assert.match(stylesSource, /\.weightGuardBetaValue\s*\{[^}]*color:\s*var\(--danger\);/s);
    assert.match(
      stylesSource,
      /\.weightGuardBeta\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*auto auto;/,
    );
  });

  it("defines a responsive two-column summary that stacks on narrow screens", () => {
    assert.match(stylesSource, /\.weightGuard\.ok\s*\{[^}]*grid-template-columns:/s);
    assert.match(stylesSource, /\.weightGuardBetaValue\s*\{[^}]*font-size:/s);
    assert.match(
      stylesSource,
      /@media \(max-width: 760px\)[\s\S]*?\.weightGuard\.ok\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
  });

  it("uses the shared Morandi gray-green tone for the valid target summary", () => {
    assert.match(stylesSource, /\.weightGuard\.ok\s*\{[^}]*color:\s*var\(--primary-dark\);[^}]*background:\s*#edf0ec;/s);
    assert.match(stylesSource, /\.weightGuardSummary > span\s*\{[^}]*color:\s*rgba\(95, 108, 100, 0\.82\);/s);
    assert.match(stylesSource, /\.weightGuardBeta\s*\{[^}]*border:\s*1px solid rgba\(120, 134, 125, 0\.2\);/s);
  });
});
