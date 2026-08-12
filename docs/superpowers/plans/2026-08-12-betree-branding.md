# Betree Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public App header with a centered handwritten `Betree` wordmark, publish the installed name as `Betree 曝險管理`, and ship a new black-and-white abstract `B` App icon whose lower mass communicates asset accumulation.

**Architecture:** Keep the change inside the existing Next.js App Router shell: `AppHeader` owns the public in-App wordmark, `layout.js` and `manifest.js` own install metadata, and `public/icons` owns static PWA assets. Use `next/font/google` to self-host Caveat at build time, keep admin headers unchanged, and derive all icon sizes from one approved 1254px source image.

**Tech Stack:** Next.js 16 App Router, React 19, CSS, `next/font/google`, Node test runner, PNG PWA assets, macOS `sips` for deterministic resizing.

## Global Constraints

- The public header displays only one centered line: `Betree`.
- Use Caveat 600 at 40px for the wordmark with a cursive fallback, `--text` color, a 28px compact header/line-height, and no clickable behavior.
- Do not show `曝險管理` inside the App header.
- The installed App name is exactly `Betree 曝險管理` in manifest metadata and Apple Web App metadata.
- The App icon is a pure black field with one white abstract uppercase `B`: a continuous left spine, smaller upper mass, larger lower mass, and black negative-space channel.
- The icon contains no text label, tree, leaf, coin, arrow, chart, gradient, shadow, or texture.
- Do not copy the Threads glyph or another existing trademark.
- Preserve the existing admin headers, bottom navigation, calculations, storage, and investment behavior.
- Support public header widths down to 320px without wrapping or increasing the existing header height.

---

### Task 1: Public Betree Wordmark

**Files:**
- Modify: `tests/morandi-ui.test.js`
- Modify: `app/layout.js`
- Modify: `app/page.js:1361-1376`
- Modify: `app/globals.css:92-141`
- Modify: `app/globals.css:3080-3100`

**Interfaces:**
- Consumes: the existing `AppHeader()` component rendered only by the public page.
- Produces: body CSS variable `--font-betree`, `.betreeWordmark`, and public header markup `<p className="betreeWordmark">Betree</p>`.

- [ ] **Step 1: Write the failing public-header UI test**

Add a test that reads `app/page.js`, `app/layout.js`, and `app/globals.css` and asserts the public header contract without constraining admin markup:

```js
test("public header uses the centered handwritten Betree wordmark", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  const publicHeader = page.match(/function AppHeader\(\)[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(publicHeader, /className="betreeWordmark"[^>]*>\s*Betree\s*</);
  assert.doesNotMatch(publicHeader, /JJ Invest System|brandGlyph|曝險管理/);
  assert.match(layout, /Caveat\(\{[\s\S]*weight:\s*"600"/);
  assert.match(layout, /variable:\s*"--font-betree"/);
  assert.match(css, /\.appHeader\s*\{[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*font-family:\s*var\(--font-betree\)/);
  assert.match(css, /\.betreeWordmark\s*\{[\s\S]*white-space:\s*nowrap/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/morandi-ui.test.js`

Expected: FAIL because `AppHeader` still contains `brandGlyph` and `JJ Invest System`, and Caveat is not configured.

- [ ] **Step 3: Add the self-hosted Caveat font and minimal public markup**

In `app/layout.js`, add:

```js
import { Caveat } from "next/font/google";

const betreeWordmarkFont = Caveat({
  subsets: ["latin"],
  weight: "500",
  display: "swap",
  variable: "--font-betree",
});
```

Apply the variable without removing existing body behavior:

```jsx
<body className={betreeWordmarkFont.variable}>
```

Replace only the public `AppHeader()` body in `app/page.js`:

```jsx
function AppHeader() {
  return (
    <header className="appHeader">
      <p className="betreeWordmark">Betree</p>
    </header>
  );
}
```

- [ ] **Step 4: Replace obsolete public brand styles**

Keep `.brandLockup` and `.brandGlyph` rules because admin pages still consume them. Update `.appHeader` and add the public wordmark rule:

```css
.appHeader {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  margin-bottom: 22px;
}

.betreeWordmark {
  margin: 0;
  color: var(--text);
  font-family: var(--font-betree), "Snell Roundhand", "Segoe Script", cursive;
  font-size: 40px;
  font-weight: 600;
  line-height: 0.95;
  white-space: nowrap;
}
```

Remove or narrow any mobile rule that changes `.brandLockup` for the public header; do not delete admin brand styles.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/morandi-ui.test.js tests/dynamic-beta-admin-page-integration.test.js`

Expected: PASS, including the admin assertion that its `<h1>` remains `JJ Invest System`.

- [ ] **Step 6: Commit the public wordmark**

```bash
git add app/layout.js app/page.js app/globals.css tests/morandi-ui.test.js
git commit -m "feat: add Betree public wordmark"
```

### Task 2: Installed App Name

**Files:**
- Modify: `tests/pwa.test.js`
- Modify: `app/layout.js:5-20`
- Modify: `app/manifest.js:1-8`

**Interfaces:**
- Consumes: Next.js exported `metadata` and the `manifest()` return object.
- Produces: exact public install name `Betree 曝險管理` for document title, application name, Apple Web App title, manifest name, and manifest short name.

- [ ] **Step 1: Write failing metadata and manifest tests**

Update the existing manifest test and add a layout-source assertion:

```js
test("manifest publishes the Betree installed name", () => {
  const data = manifest();

  assert.equal(data.name, "Betree 曝險管理");
  assert.equal(data.short_name, "Betree 曝險管理");
  assert.equal(data.start_url, "/");
  assert.equal(data.scope, "/");
  assert.equal(data.display, "standalone");
});

test("root metadata publishes the Betree installed name", async () => {
  const layout = await readFile(new URL("../app/layout.js", import.meta.url), "utf8");

  assert.match(layout, /title:\s*"Betree 曝險管理"/);
  assert.match(layout, /applicationName:\s*"Betree 曝險管理"/);
  assert.match(layout, /appleWebApp:\s*\{[\s\S]*title:\s*"Betree 曝險管理"/);
});
```

- [ ] **Step 2: Run the PWA test and verify failure**

Run: `node --test tests/pwa.test.js`

Expected: FAIL because metadata and manifest still use `JJ Invest System`.

- [ ] **Step 3: Update public metadata and manifest copy**

In `app/layout.js`, set:

```js
title: "Betree 曝險管理",
description: "投資組合曝險管理與 Beta 再平衡工具",
applicationName: "Betree 曝險管理",
```

and:

```js
appleWebApp: {
  capable: true,
  title: "Betree 曝險管理",
  statusBarStyle: "default",
},
```

In `app/manifest.js`, set:

```js
name: "Betree 曝險管理",
short_name: "Betree 曝險管理",
description: "投資組合曝險管理與 Beta 再平衡工具",
```

- [ ] **Step 4: Run the PWA test**

Run: `node --test tests/pwa.test.js`

Expected: PASS with the existing standalone, theme, and icon assertions preserved.

- [ ] **Step 5: Commit installed-name metadata**

```bash
git add app/layout.js app/manifest.js tests/pwa.test.js
git commit -m "feat: rename installed app to Betree"
```

### Task 3: Abstract Compounding App Icon

**Files:**
- Create: `public/icons/betree-icon-source.png`
- Modify: `public/icons/icon-192.png`
- Modify: `public/icons/icon-512.png`
- Modify: `public/icons/maskable-512.png`
- Modify: `public/icons/apple-touch-icon.png`
- Modify: `public/sw.js`
- Modify: `tests/pwa.test.js`

**Interfaces:**
- Consumes: approved enlarged abstract `B` source `/Users/jjlin/.codex/generated_images/019ff47a-7b7e-76e1-bf8a-7356a4391ef5/exec-01cd44c0-335c-494c-a41b-1f2eca34ddc2.png`.
- Produces: one versioned 1254px source plus PNG outputs at 180, 192, and 512 pixels referenced by existing metadata and manifest paths.

- [ ] **Step 1: Write failing PNG dimension and identity tests**

Add a PNG header reader and assertions to `tests/pwa.test.js`:

```js
async function readPngDimensions(relativePath) {
  const png = await readFile(new URL(relativePath, import.meta.url));
  assert.equal(png.toString("ascii", 1, 4), "PNG");
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

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
  const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

  assert.match(sw, /const CACHE_NAME = "jj-invest-public-v2"/);
  assert.match(sw, /"\/icons\/icon-192\.png"/);
  assert.match(sw, /"\/icons\/icon-512\.png"/);
  assert.match(sw, /"\/icons\/maskable-512\.png"/);
  assert.match(sw, /"\/icons\/apple-touch-icon\.png"/);
});
```

- [ ] **Step 2: Run the source-asset test and verify failure**

Run: `node --test tests/pwa.test.js`

Expected: FAIL with `ENOENT` for `public/icons/betree-icon-source.png`.

- [ ] **Step 3: Add the approved abstract compounding source**

Copy the approved built-in image-generation output into the project without deleting the generated original:

```bash
cp /Users/jjlin/.codex/generated_images/019ff47a-7b7e-76e1-bf8a-7356a4391ef5/exec-01cd44c0-335c-494c-a41b-1f2eca34ddc2.png public/icons/betree-icon-source.png
```

The selected source is a black field with one enlarged white abstract uppercase `B`: a continuous left spine, a smaller upper mass, a larger lower mass, and one black negative-space channel. It contains no text label, tree, leaf, currency mark, arrow, chart, gradient, shadow, or texture.

- [ ] **Step 4: Generate all production icon sizes**

Use copies so the 1254px source remains unchanged:

```bash
cp public/icons/betree-icon-source.png public/icons/icon-512.png
sips -z 512 512 public/icons/icon-512.png
cp public/icons/betree-icon-source.png public/icons/maskable-512.png
sips -z 512 512 public/icons/maskable-512.png
cp public/icons/betree-icon-source.png public/icons/icon-192.png
sips -z 192 192 public/icons/icon-192.png
cp public/icons/betree-icon-source.png public/icons/apple-touch-icon.png
sips -z 180 180 public/icons/apple-touch-icon.png
```

Update the service-worker cache version so existing installations do not keep serving the prior icon assets forever:

```js
const CACHE_NAME = "jj-invest-public-v2";
```

- [ ] **Step 5: Run tests and inspect small-size output**

Run: `node --test tests/pwa.test.js`

Expected: PASS.

Open `public/icons/icon-192.png` and `public/icons/apple-touch-icon.png` at original size. Confirm the white expanding curve is recognizable, the pure black field reaches every edge, and maskable cropping does not remove the outer curve.

- [ ] **Step 6: Commit icon assets**

```bash
git add public/icons public/sw.js tests/pwa.test.js
git commit -m "feat: add Betree compounding app icon"
```

### Task 4: Full Verification

**Files:**
- Verify only; modify earlier task files only when a verification failure directly identifies a defect in this feature.

**Interfaces:**
- Consumes: the public wordmark, install metadata, source icon, and derived icon assets from Tasks 1–3.
- Produces: a verified production build ready for review.

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: exit code 0 with no errors.

- [ ] **Step 3: Run the production build**

Run: `pnpm build`

Expected: Next.js production build succeeds and self-hosts the Caveat font asset.

- [ ] **Step 4: Verify the public page at mobile and desktop widths**

Run: `pnpm dev`

Inspect `/` at 320px, 375px, and desktop width. Confirm `Betree` is visually centered, remains one line, the header is no taller than before, the first overview card does not jump after font load, and the browser title is `Betree 曝險管理`.

- [ ] **Step 5: Verify installation metadata and admin isolation**

Inspect `/manifest.webmanifest` and confirm `name` and `short_name` equal `Betree 曝險管理`. Inspect `/admin/dynamic-beta` and `/admin/usage` and confirm their existing `JJ Invest System` headers and glyphs remain unchanged.

- [ ] **Step 6: Record final branch state**

Run: `git status --short --branch`

Expected: branch is `feat/betree-branding`; only the user's pre-existing untracked `.superpowers/`, `ig-app-intro/`, and `reels-beta-update/` paths remain, with no uncommitted feature files.
