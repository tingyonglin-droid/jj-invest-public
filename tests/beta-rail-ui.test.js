import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("beta rail shows evenly spaced integer ticks across the 0-3 scale", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(
    page,
    /className="betaScale">\s*<span>\{betaRail\.scaleMin\}<\/span>\s*<span>1<\/span>\s*<span>2<\/span>\s*<span>\{betaRail\.scaleMax\}<\/span>/s,
  );
});
