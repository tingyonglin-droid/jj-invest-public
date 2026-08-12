import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("removes the visible and accessible quote refresh control", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.doesNotMatch(page, /headerStatusPill/);
  assert.doesNotMatch(page, /aria-label="更新價格"/);
  assert.doesNotMatch(page, /自動更新/);
  assert.doesNotMatch(page, /function AppHeader\([^)]/);
  assert.doesNotMatch(css, /\.headerStatusPill/);
  assert.doesNotMatch(css, /\.headerActions/);
});
