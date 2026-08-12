import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

import manifest from "../app/manifest.js";

async function readPngDimensions(relativePath) {
  const png = await readFile(new URL(relativePath, import.meta.url));

  assert.equal(png.toString("ascii", 1, 4), "PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

test("manifest publishes the Betree installed name", () => {
  const data = manifest();

  assert.equal(data.name, "Betree 曝險管理");
  assert.equal(data.short_name, "Betree 曝險管理");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.display, "standalone");
  assert.equal(data.theme_color, "#f6f7f9");
  assert.ok(data.icons.some((icon) => icon.sizes === "192x192" && icon.type === "image/png"));
  assert.ok(data.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("root metadata publishes the Betree installed name", async () => {
  const layout = await readFile(new URL("../app/layout.js", import.meta.url), "utf8");

  assert.match(layout, /title:\s*"Betree 曝險管理"/);
  assert.match(layout, /applicationName:\s*"Betree 曝險管理"/);
  assert.match(layout, /appleWebApp:\s*\{[\s\S]*title:\s*"Betree 曝險管理"/);
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

test("service worker leaves Next.js build assets to the browser and network", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  let respondWithCalls = 0;

  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: { claim() {} },
    location: { origin: "http://localhost:3000" },
    skipWaiting() {},
  };

  vm.runInNewContext(source, {
    URL,
    caches: {
      delete() {},
      keys: async () => [],
      match() {
        throw new Error("Next.js assets must not reach the service-worker cache");
      },
      open() {
        throw new Error("Next.js assets must not open the service-worker cache");
      },
    },
    fetch() {
      throw new Error("Next.js assets must not be fetched by the service worker");
    },
    self,
  });

  listeners.get("fetch")({
    request: {
      method: "GET",
      mode: "no-cors",
      url: "http://localhost:3000/_next/static/chunks/app.css",
    },
    respondWith() {
      respondWithCalls += 1;
    },
  });

  assert.equal(respondWithCalls, 0);
});

test("Betree icon assets use the required square sizes", async () => {
  assert.deepEqual(await readPngDimensions("../public/icons/apple-touch-icon.png"), {
    width: 180,
    height: 180,
  });
  assert.deepEqual(await readPngDimensions("../public/icons/icon-192.png"), {
    width: 192,
    height: 192,
  });
  assert.deepEqual(await readPngDimensions("../public/icons/icon-512.png"), {
    width: 512,
    height: 512,
  });
  assert.deepEqual(await readPngDimensions("../public/icons/maskable-512.png"), {
    width: 512,
    height: 512,
  });
});

test("Betree icon source is versioned with the PWA assets", async () => {
  const source = await readPngDimensions("../public/icons/betree-icon-source.png");

  assert.deepEqual(source, { width: 1254, height: 1254 });
});

test("service worker refreshes the Betree icon cache", async () => {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

  assert.match(source, /jj-invest-public-v2/);
});
