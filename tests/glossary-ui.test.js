import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

test("overview exposes glossary entry with accessible label", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /infoLabel="查看 Beta 說明"/);
  assert.match(page, /infoLabel="查看正二、原形與現金說明"/);
  assert.match(page, /function GlossaryDialog/);
});

test("glossary explains beta in detail", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /Beta 代表投資組合相對市場的波動與曝險程度/);
  assert.match(page, /Beta 1\.0 約等於跟大盤同方向/);
  assert.match(page, /Beta 2\.0 約等於大盤變動 1%/);
  assert.match(page, /目標 Beta 是你想維持的整體曝險/);
  assert.match(page, /容忍區間用來避免太頻繁調整/);
});

test("allocation glossary explains leveraged, original, and cash assets", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");

  assert.match(page, /正二是 Beta 約 2 的槓桿型標的/);
  assert.match(page, /原形是 Beta 約 1 的非槓桿標的/);
  assert.match(page, /現金是台幣現金與美金現金換算成台幣後的加總/);
});
