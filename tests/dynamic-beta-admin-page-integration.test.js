import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

const SECTION_IDS = ["today", "briefs", "confirmations", "data", "more"];

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const originalActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

function dataModule(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function transformComponent(componentUrl, replacements = []) {
  let source = await readFile(componentUrl, "utf8");
  for (const [before, after] of replacements) {
    const nextSource = source.replace(before, after);
    assert.notEqual(nextSource, source, `Expected component import: ${before}`);
    source = nextSource;
  }

  const jsxRuntimeUrl = new URL(
    "../node_modules/react/jsx-runtime.js",
    import.meta.url,
  ).href;
  const transformed = transformSync(source, {
    filename: componentUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  return dataModule(transformed);
}

function sectionModule(sectionId, reactUrl) {
  return dataModule(`
    import React, { useEffect, useSyncExternalStore } from ${JSON.stringify(reactUrl)};
    const IDLE_LIFECYCLE = Object.freeze({ phase: "idle" });
    const subscribeIdle = () => () => {};
    const getIdle = () => IDLE_LIFECYCLE;
    export default function ${sectionId}Section({
      onOpenSection,
      draftController,
      adminAccess,
      onAuthorizationLoss,
    }) {
      useEffect(() => {
        globalThis.__adminSectionLoads[${JSON.stringify(sectionId)}] += 1;
        return () => {
          globalThis.__adminSectionUnmounts[${JSON.stringify(sectionId)}] += 1;
        };
      }, []);
      const lifecycleSnapshot = useSyncExternalStore(
        draftController?.subscribeLifecycle || subscribeIdle,
        draftController?.getLifecycleSnapshot || getIdle,
        draftController?.getLifecycleSnapshot || getIdle,
      );
      const children = [${JSON.stringify(`${sectionId} section`)}];
      children.push(React.createElement("button", {
        key: "authorization-loss",
        type: "button",
        onClick() {
          const error = Object.assign(new Error("管理權限已失效。"), {
            kind: "authorization",
          });
          const requestAccessEpoch = adminAccess?.beginAccessRequest?.();
          if (typeof onAuthorizationLoss === "function") {
            onAuthorizationLoss(error, requestAccessEpoch);
          }
        },
      }, "回報授權失效"));
      if (${JSON.stringify(sectionId)} === "today") {
        children.push(React.createElement("button", {
          key: "shortcut",
          type: "button",
          onClick() {
            if (typeof onOpenSection === "function") onOpenSection("data");
          },
        }, "查看全部資料"));
        children.push(React.createElement("button", {
          key: "lifecycle",
          type: "button",
          onClick() {
            if (!draftController) return;
            void draftController.approve({
              token: "local-admin",
              draft: {
                briefDate: "2026-07-28",
                draftRevisionId: "ndrv_page_shared",
                draftRevisionNumber: 1,
                status: "pending",
              },
              reload: async () => ({ drafts: [] }),
            }).catch(() => {});
          },
        }, "開始 lifecycle"));
      }
      return React.createElement("section", {
        "data-loaded-section": ${JSON.stringify(sectionId)},
        "data-lifecycle-active": lifecycleSnapshot.phase !== "idle"
          ? "true"
          : "false",
        "data-lifecycle-phase": lifecycleSnapshot.phase,
        "data-has-admin-access": adminAccess ? "true" : "false",
      }, ...children);
    }
  `);
}

async function loadAdminPage() {
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const workspaceModelUrl = new URL(
    "../src/lib/dynamic-beta/admin-workspace.js",
    import.meta.url,
  ).href;
  const draftControllerUrl = new URL(
    "../src/lib/dynamic-beta/news/draft-panel-controller.js",
    import.meta.url,
  ).href;
  const navigationUrl = await transformComponent(
    new URL(
      "../app/admin/dynamic-beta/AdminWorkspaceNavigation.js",
      import.meta.url,
    ),
    [
      ['from "react";', `from "${reactUrl}";`],
      [
        'from "../../../src/lib/dynamic-beta/admin-workspace.js";',
        `from "${workspaceModelUrl}";`,
      ],
    ],
  );
  const pageUrl = new URL("../app/admin/dynamic-beta/page.js", import.meta.url);
  const componentImports = [
    ["AdminWorkspaceNavigation", navigationUrl],
    ["TodayWorkspaceSection", sectionModule("today", reactUrl)],
    ["BriefsAdminSection", sectionModule("briefs", reactUrl)],
    ["ConfirmationAdminSection", sectionModule("confirmations", reactUrl)],
    ["MarketDataAdminSection", sectionModule("data", reactUrl)],
    ["AdvancedToolsSection", sectionModule("more", reactUrl)],
  ];
  const replacements = [
    ['from "react";', `from "${reactUrl}";`],
    ...componentImports.map(([name, url]) => [
      `import ${name} from "./${name}.js";`,
      `import ${name} from "${url}";`,
    ]),
    [
      'from "../../../src/lib/dynamic-beta/admin-workspace.js";',
      `from "${workspaceModelUrl}";`,
    ],
    [
      'from "../../../src/lib/dynamic-beta/news/draft-panel-controller.js";',
      `from "${draftControllerUrl}";`,
    ],
  ];
  const moduleUrl = await transformComponent(pageUrl, replacements);
  return (await import(moduleUrl)).default;
}

function createBrowserWindow(initialHref) {
  let href = initialHref;
  const listeners = new Map();
  const pushStateCalls = [];
  const location = {};
  Object.defineProperty(location, "href", {
    get: () => href,
    set: (value) => { href = new URL(value, href).href; },
  });

  const browserWindow = {
    location,
    confirm: () => true,
    prompt: () => "",
    history: {
      state: { retained: "history-state" },
      pushState(state, title, nextHref) {
        pushStateCalls.push({ state, title, href: nextHref });
        this.state = state;
        href = new URL(nextHref, href).href;
      },
    },
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) || new Set();
      typeListeners.add(listener);
      listeners.set(type, typeListeners);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) || []) listener({ type });
    },
  };

  return {
    browserWindow,
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    pushStateCalls,
  };
}

function activeButtons(renderer, navigationClassName) {
  const navigation = renderer.root.findAll((node) => (
    node.type === "nav" && node.props.className === navigationClassName
  ))[0];
  return navigation.findAllByType("button").filter((button) => (
    button.props["aria-current"] === "page"
  ));
}

function mountedSections(renderer) {
  return renderer.root.findAll((node) => node.props["data-loaded-section"]);
}

function resetSectionLifecycleCounts() {
  globalThis.__adminSectionLoads = Object.fromEntries(SECTION_IDS.map((id) => [id, 0]));
  globalThis.__adminSectionUnmounts = Object.fromEntries(SECTION_IDS.map((id) => [id, 0]));
}

async function renderPage(href) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  resetSectionLifecycleCounts();
  const browser = createBrowserWindow(href);
  globalThis.window = browser.browserWindow;
  const DynamicBetaAdminPage = await loadAdminPage();
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(DynamicBetaAdminPage));
  });
  return { browser, renderer };
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
  globalThis.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  delete globalThis.__adminSectionLoads;
  delete globalThis.__adminSectionUnmounts;
});

describe("dynamic beta admin page integration", () => {
  it("keeps SSR neutral, then resolves a direct non-Today URL without mounting Today first", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetSectionLifecycleCounts();
    delete globalThis.window;
    const DynamicBetaAdminPage = await loadAdminPage();

    const serverMarkup = renderToString(React.createElement(DynamicBetaAdminPage));
    assert.match(serverMarkup, /JJ Invest System/);
    assert.match(serverMarkup, /<h1[^>]*>JJ Invest System<\/h1>/);
    assert.match(serverMarkup, /Loading workspace/);
    assert.doesNotMatch(serverMarkup, /data-loaded-section/);
    assert.doesNotMatch(serverMarkup, /role="tabpanel"/);
    assert.deepEqual(globalThis.__adminSectionLoads, {
      today: 0,
      briefs: 0,
      confirmations: 0,
      data: 0,
      more: 0,
    });

    const browser = createBrowserWindow(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data",
    );
    globalThis.window = browser.browserWindow;
    let renderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(DynamicBetaAdminPage));
      });
      assert.deepEqual(
        mountedSections(renderer).map((node) => node.props["data-loaded-section"]),
        ["data"],
      );
      assert.deepEqual(globalThis.__adminSectionLoads, {
        today: 0,
        briefs: 0,
        confirmations: 0,
        data: 1,
        more: 0,
      });
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("defaults missing and invalid section queries to one mounted Today panel", async () => {
    for (const href of [
      "http://localhost:3000/admin/dynamic-beta?token=local-admin",
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=invalid",
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data&section=more",
    ]) {
      const { renderer } = await renderPage(href);
      try {
        const panels = renderer.root.findAll((node) => node.props.role === "tabpanel");
        assert.equal(panels.length, 1);
        assert.equal(panels[0].props.id, "admin-section-today");
        assert.equal(panels[0].props["aria-label"], "Today workspace section");
        assert.deepEqual(
          mountedSections(renderer).map((node) => node.props["data-loaded-section"]),
          ["today"],
        );
      } finally {
        await TestRenderer.act(async () => renderer.unmount());
      }
    }
  });

  it("mounts only the URL-selected section so inactive sections do not load", async () => {
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data",
    );
    try {
      assert.deepEqual(
        mountedSections(renderer).map((node) => node.props["data-loaded-section"]),
        ["data"],
      );
      assert.deepEqual(globalThis.__adminSectionLoads, {
        today: 0,
        briefs: 0,
        confirmations: 0,
        data: 1,
        more: 0,
      });
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("gives desktop and mobile navigation the same single active destination", async () => {
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=confirmations",
    );
    try {
      for (const className of [
        "adminWorkspaceDesktopNav",
        "adminWorkspaceMobileNav",
      ]) {
        const active = activeButtons(renderer, className);
        assert.equal(active.length, 1);
        assert.equal(active[0].props["aria-label"], "Confirmations");
      }
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("pushes a token-preserving URL and swaps the mounted section on selection", async () => {
    const { browser, renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&view=compact&section=today#review",
    );
    try {
      const moreButton = renderer.root.findAllByType("button").find((button) => (
        button.props["aria-label"] === "More"
        && button.parent?.props.className === "adminWorkspaceMobileNav"
      ));
      await TestRenderer.act(async () => moreButton.props.onClick());

      assert.deepEqual(browser.pushStateCalls, [{
        state: { retained: "history-state" },
        title: "",
        href: "/admin/dynamic-beta?token=local-admin&view=compact&section=more#review",
      }]);
      assert.equal(
        renderer.root.findByProps({ role: "tabpanel" }).props.id,
        "admin-section-more",
      );
      assert.equal(
        renderer.root.findByProps({ role: "tabpanel" }).props["aria-label"],
        "More workspace section",
      );
      assert.deepEqual(globalThis.__adminSectionLoads, {
        today: 1,
        briefs: 0,
        confirmations: 0,
        data: 0,
        more: 1,
      });
      assert.equal(globalThis.__adminSectionUnmounts.today, 1);
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("connects the real Today shortcut contract to URL history and the active panel", async () => {
    const { browser, renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&view=compact&section=today#review",
    );
    try {
      assert.equal(
        renderer.root.findByProps({ "data-loaded-section": "today" })
          .props["data-has-admin-access"],
        "true",
      );
      await TestRenderer.act(async () => {
        renderer.root.findAllByType("button").find((button) => (
          button.children.join("") === "查看全部資料"
        )).props.onClick();
      });

      assert.deepEqual(browser.pushStateCalls, [{
        state: { retained: "history-state" },
        title: "",
        href: "/admin/dynamic-beta?token=local-admin&view=compact&section=data#review",
      }]);
      assert.equal(
        renderer.root.findByProps({ role: "tabpanel" }).props.id,
        "admin-section-data",
      );
      assert.deepEqual(
        mountedSections(renderer).map((node) => node.props["data-loaded-section"]),
        ["data"],
      );
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("keeps one lifecycle interlock active while navigating from Today to Briefs", async () => {
    let releaseRequest;
    const requestStarted = new Promise((resolve) => {
      globalThis.fetch = async () => {
        resolve();
        await new Promise((finish) => { releaseRequest = finish; });
        return Response.json({
          saved: true,
          draft: {
            briefDate: "2026-07-28",
            draftRevisionId: "ndrv_page_shared",
            draftRevisionNumber: 1,
            status: "approved",
          },
        });
      };
    });
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=today",
    );
    try {
      await TestRenderer.act(async () => {
        renderer.root.findAllByType("button").find((button) => (
          button.children.join("") === "開始 lifecycle"
        )).props.onClick();
        await Promise.race([requestStarted, new Promise((resolve) => setImmediate(resolve))]);
      });

      const briefsButton = renderer.root.findAllByType("button").find((button) => (
        button.props["aria-label"] === "Briefs"
        && button.props.role === "tab"
      ));
      await TestRenderer.act(async () => briefsButton.props.onClick());

      assert.equal(
        renderer.root.findByProps({ "data-loaded-section": "briefs" })
          .props["data-lifecycle-active"],
        "true",
      );
    } finally {
      if (releaseRequest) releaseRequest();
      await TestRenderer.act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        renderer.unmount();
      });
    }
  });

  it("keeps the navigated panel invalidated when an earlier lifecycle request loses access", async () => {
    let releaseRequest;
    const requestStarted = new Promise((resolve) => {
      globalThis.fetch = async () => {
        resolve();
        await new Promise((finish) => { releaseRequest = finish; });
        return Response.json({ error: "管理權限已失效。" }, { status: 403 });
      };
    });
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=today",
    );
    try {
      await TestRenderer.act(async () => {
        renderer.root.findAllByType("button").find((button) => (
          button.children.join("") === "開始 lifecycle"
        )).props.onClick();
        await Promise.race([requestStarted, new Promise((resolve) => setImmediate(resolve))]);
      });

      const briefsButton = renderer.root.findAllByType("button").find((button) => (
        button.props["aria-label"] === "Briefs"
        && button.props.role === "tab"
      ));
      await TestRenderer.act(async () => briefsButton.props.onClick());
      await TestRenderer.act(async () => {
        releaseRequest();
        await new Promise((resolve) => setImmediate(resolve));
      });

      const briefs = renderer.root.findByProps({ "data-loaded-section": "briefs" });
      assert.equal(briefs.props["data-lifecycle-phase"], "access-denied");
      assert.equal(briefs.props["data-lifecycle-active"], "true");
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("invalidates shared draft controls when another workspace reader loses authorization", async () => {
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=data",
    );
    try {
      assert.equal(
        renderer.root.findByProps({ "data-loaded-section": "data" })
          .props["data-has-admin-access"],
        "true",
      );
      await TestRenderer.act(async () => {
        renderer.root.findAllByType("button").find((button) => (
          button.children.join("") === "回報授權失效"
        )).props.onClick();
      });
      const briefsButton = renderer.root.findAllByType("button").find((button) => (
        button.props["aria-label"] === "Briefs"
        && button.props.role === "tab"
      ));
      await TestRenderer.act(async () => briefsButton.props.onClick());

      const briefs = renderer.root.findByProps({ "data-loaded-section": "briefs" });
      assert.equal(briefs.props["data-lifecycle-phase"], "access-denied");
      assert.equal(briefs.props["data-lifecycle-active"], "true");
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });

  it("restores the URL-selected section on popstate and removes its listener", async () => {
    const { browser, renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=today",
    );
    assert.equal(browser.listenerCount("popstate"), 1);

    browser.browserWindow.location.href = "/admin/dynamic-beta?token=local-admin&section=briefs";
    await TestRenderer.act(async () => browser.browserWindow.dispatch("popstate"));
    assert.equal(
      renderer.root.findByProps({ role: "tabpanel" }).props.id,
      "admin-section-briefs",
    );
    assert.deepEqual(
      mountedSections(renderer).map((node) => node.props["data-loaded-section"]),
      ["briefs"],
    );

    await TestRenderer.act(async () => renderer.unmount());
    assert.equal(browser.listenerCount("popstate"), 0);
  });

  it("does not expose a separate morning-brief route", async () => {
    const { renderer } = await renderPage(
      "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=briefs",
    );
    try {
      const hrefs = renderer.root.findAllByType("a").map((link) => link.props.href);
      assert.equal(hrefs.some((href) => String(href).includes("/morning-brief")), false);
    } finally {
      await TestRenderer.act(async () => renderer.unmount());
    }
  });
});

describe("dynamic beta admin responsive CSS contracts", () => {
  function relativeLuminance(hex) {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) => (
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function contrastRatio(foreground, background) {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
    return (lighter + 0.05) / (darker + 0.05);
  }

  it("scopes mobile safe-area navigation, touch targets, wrapping, and overflow containment", async () => {
    const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

    const pageRule = css.match(/\.dynamicBetaAdmin\s*\{([^}]*)\}/s)?.[1] || "";
    assert.match(pageRule, /font-size:\s*16px;/);
    assert.match(pageRule, /overflow-x:\s*clip;/);
    assert.match(css, /\.adminWorkspacePanel\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
    assert.match(css, /\.dynamicBetaAdmin\s+:where\(button,\s*input,\s*select\)\s*\{[^}]*min-height:\s*44px;/s);
    assert.match(css, /\.dynamicBetaAdmin\s+:where\(a,\s*code\)\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.adminWorkspaceMobileNav\s*\{[^}]*position:\s*fixed;[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\);[^}]*env\(safe-area-inset-bottom\)/s);
    assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.adminWorkspaceMobileItem\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/s);
    assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.adminWorkspacePanel\s+\.positionTitle\s*\{[^}]*align-items:\s*stretch;[^}]*flex-direction:\s*column;/s);
    assert.match(css, /\.morningBriefLifecycleActions\s*\{[^}]*display:\s*flex;[^}]*gap:\s*8px;/s);
    assert.match(css, /\.morningBriefRejectButton\s*\{[^}]*color:\s*#[0-9a-fA-F]{6};/s);
  });

  it("keeps detail scrolling local and desktop navigation available at tablet and desktop widths", async () => {
    const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

    assert.match(css, /\.adminWideTableScroll\s*\{[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;/s);
    assert.match(css, /\.dynamicBetaAdmin\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
    assert.match(css, /@media\s*\(min-width:\s*761px\)[\s\S]*?\.adminWorkspaceDesktopNav\s*\{[^}]*display:\s*block;/s);
    assert.match(css, /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.adminWorkspaceMobileNav\s*\{[^}]*display:\s*none;/s);
  });

  it("gives scoped admin hints 16px text and computed AA contrast on every hint surface", async () => {
    const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
    const hintRule = css.match(/\.dynamicBetaAdmin\s+\.hint\s*\{([^}]*)\}/s)?.[1] || "";
    assert.match(hintRule, /font-size:\s*16px;/);
    const colorValue = hintRule.match(/color:\s*var\(--([\w-]+)\)/)?.[1];
    assert.ok(colorValue, "scoped hint color must use an existing semantic token");
    const tokenValue = css.match(new RegExp(`--${colorValue}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
    assert.ok(tokenValue, `missing semantic color token --${colorValue}`);
    for (const background of ["#ffffff", "#f8fafb", "#fff8e6"]) {
      assert.ok(
        contrastRatio(tokenValue, background) >= 4.5,
        `${tokenValue} must meet 4.5:1 on ${background}`,
      );
    }
  });
});
