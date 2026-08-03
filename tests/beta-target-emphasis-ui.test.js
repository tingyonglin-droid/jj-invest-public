import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("Beta target emphasis UI", () => {
  it("renders the calculated Beta in a dedicated visual badge", () => {
    assert.match(pageSource, /className="weightGuardSummary"/);
    assert.match(pageSource, /className="weightGuardBeta"/);
    assert.match(pageSource, /className="weightGuardBetaLabel">換算 Beta/);
    assert.match(pageSource, /className="weightGuardBetaValue"/);
    assert.match(pageSource, /≈\{" "\}\{formatNumber\(calculation\.targetBeta\)\}/);
  });

  it("defines a responsive two-column summary that stacks on narrow screens", () => {
    assert.match(stylesSource, /\.weightGuard\.ok\s*\{[^}]*grid-template-columns:/s);
    assert.match(stylesSource, /\.weightGuardBetaValue\s*\{[^}]*font-size:/s);
    assert.match(
      stylesSource,
      /@media \(max-width: 760px\)[\s\S]*?\.weightGuard\.ok\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
  });
});
