import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("beta rail renders the ticks selected by its dynamic scale", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(
    page,
    /betaRail\.scaleTicks\.map\(\(tick\) => \(\s*<span key=\{tick\}>\{formatBetaScaleTick\(tick\)\}<\/span>/s,
  );
});

test("beta card hides an unset target and keeps configured edge labels inside the rail", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(page, /<BetaCard[\s\S]*?hasTargetBeta=\{formState\.targetBeta !== ""\}/s);
  assert.match(page, /function BetaCard\(\{ action, calculation, betaRail, hasTargetBeta,/);
  assert.match(page, /<strong>\{hasTargetBeta \? betaSummary\.targetText : "尚未設定"\}<\/strong>/);
  assert.match(
    page,
    /\{hasTargetBeta && \(\s*<>\s*<span className="targetMarker" \/>\s*<span className="targetLabel">目標 \{formatNumber\(calculation\.targetBeta\)\}<\/span>\s*<\/>\s*\)\}/s,
  );
  assert.match(
    styles,
    /\.targetLabel\s*\{[^}]*left:\s*clamp\(64px, var\(--beta-target\), calc\(100% - 64px\)\);/s,
  );
});
