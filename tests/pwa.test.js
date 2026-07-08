import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import manifest from "../app/manifest.js";

test("manifest enables standalone PWA install", () => {
  const data = manifest();

  assert.equal(data.name, "JJ Invest System");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.display, "standalone");
  assert.equal(data.theme_color, "#f6f7f9");
  assert.ok(data.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(data.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("root layout registers the service worker", async () => {
  const layout = await readFile(new URL("../app/layout.js", import.meta.url), "utf8");

  assert.match(layout, /RegisterServiceWorker/);
  assert.match(layout, /<RegisterServiceWorker\s*\/>/);
});

test("service worker avoids caching quote API responses", async () => {
  const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

  assert.match(sw, /pathname\.startsWith\(["']\/api\/["']\)/);
});
