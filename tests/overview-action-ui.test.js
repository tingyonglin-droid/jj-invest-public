import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pageSource = readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("overview action UI", () => {
  it("places the overview action in the beta card and removes the separate advice card", () => {
    assert.match(pageSource, /className={`betaAction betaInlineAction \$\{action\.tone\}`}/);
    assert.match(pageSource, /aria-label=\{action\.ariaLabel\}/);
    assert.doesNotMatch(pageSource, /function AdviceCard/);
    assert.doesNotMatch(pageSource, /<AdviceCard/);
  });

  it("adds eight pixels between the mobile market legend and footer divider", () => {
    assert.match(
      cssSource,
      /@media \(max-width: 480px\)[\s\S]*?\.marketLevelLegend\s*\{[\s\S]*?margin-bottom:\s*8px;/,
    );
  });

  it("places every overview status beside the current Beta value", () => {
    assert.match(
      pageSource,
      /title="目前 Beta"[\s\S]*?action=\{null\}/s,
    );
    assert.match(
      pageSource,
      /className="betaPrimary"[\s\S]*?action\.destination[\s\S]*?className={`betaAction betaInlineAction \$\{action\.tone\}`}[\s\S]*?<span className={`betaAction betaInlineAction \$\{action\.tone\}`}>/s,
    );
    assert.match(
      cssSource,
      /\.betaInlineAction\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-height:\s*36px;[^}]*padding:\s*7px 12px;[^}]*font-size:\s*13px;/s,
    );
  });

  it("uses a prominent red treatment for incomplete setup", () => {
    assert.match(
      cssSource,
      /\.betaAction\.setup\s*\{[^}]*color:\s*#963d35;[^}]*background:\s*#fde6e2;/s,
    );
  });

  it("keeps the beta target label clear of the summary tiles", () => {
    assert.match(
      cssSource,
      /\.betaRail\s*\{[^}]*margin-top:\s*40px;/s,
    );
  });
});
