import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("root layout loads Vercel Web Analytics", async () => {
  const layout = await readFile(new URL("../app/layout.js", import.meta.url), "utf8");

  assert.match(layout, /from ["']@vercel\/analytics\/next["']/);
  assert.match(layout, /<Analytics\s*\/>/);
});

test("package declares Vercel Analytics dependency", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.ok(packageJson.dependencies["@vercel/analytics"]);
});
