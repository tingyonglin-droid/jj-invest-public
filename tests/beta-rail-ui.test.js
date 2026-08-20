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
