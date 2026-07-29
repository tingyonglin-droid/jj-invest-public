import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import React from "react";
import TestRenderer from "react-test-renderer";
import { transformSync } from "next/dist/build/swc/index.js";

import {
  ADMIN_WORKSPACE_SECTIONS,
  buildAdminWorkspaceHref,
  normalizeAdminWorkspaceSection,
} from "../src/lib/dynamic-beta/admin-workspace.js";

async function loadAdminWorkspaceNavigation() {
  const componentUrl = new URL(
    "../app/admin/dynamic-beta/AdminWorkspaceNavigation.js",
    import.meta.url,
  );
  const reactUrl = new URL("../node_modules/react/index.js", import.meta.url).href;
  const jsxRuntimeUrl = new URL("../node_modules/react/jsx-runtime.js", import.meta.url).href;
  const workspaceModelUrl = new URL(
    "../src/lib/dynamic-beta/admin-workspace.js",
    import.meta.url,
  ).href;
  const source = (await readFile(componentUrl, "utf8"))
    .replace('from "react";', `from "${reactUrl}";`)
    .replace(
      'from "../../../src/lib/dynamic-beta/admin-workspace.js";',
      `from "${workspaceModelUrl}";`,
    );
  const transformed = transformSync(source, {
    filename: componentUrl.pathname,
    jsc: {
      parser: { syntax: "ecmascript", jsx: true },
      transform: { react: { runtime: "automatic" } },
    },
    module: { type: "es6" },
  }).code.replaceAll("react/jsx-runtime", jsxRuntimeUrl);
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
  return (await import(moduleUrl)).default;
}

function navigationButtons(renderer, className) {
  const navigation = renderer.root.findAll((node) => (
    node.type === "nav" && node.props.className === className
  ))[0];
  return navigation.findAllByType("button");
}

describe("dynamic beta admin workspace model", () => {
  it("defines the five workspace sections in operator order", () => {
    assert.deepEqual(
      ADMIN_WORKSPACE_SECTIONS.map((section) => section.id),
      ["today", "briefs", "confirmations", "data", "more"],
    );
  });

  it("normalizes missing, empty, unknown, and duplicated section input to today", () => {
    for (const value of [undefined, null, "", "unknown", ["today", "data"]]) {
      assert.equal(normalizeAdminWorkspaceSection(value), "today");
    }
  });

  it("preserves every valid workspace section ID", () => {
    for (const { id } of ADMIN_WORKSPACE_SECTIONS) {
      assert.equal(normalizeAdminWorkspaceSection(id), id);
    }
  });

  it("adds a section while retaining the current admin path and token", () => {
    assert.equal(
      buildAdminWorkspaceHref(
        "http://localhost:3000/admin/dynamic-beta?token=local-admin",
        "data",
      ),
      "/admin/dynamic-beta?token=local-admin&section=data",
    );
  });

  it("replaces a prior section without duplicating it", () => {
    assert.equal(
      buildAdminWorkspaceHref(
        "http://localhost:3000/admin/dynamic-beta?token=local-admin&section=briefs",
        "confirmations",
      ),
      "/admin/dynamic-beta?token=local-admin&section=confirmations",
    );
  });

  it("retains unrelated query parameters and fragments", () => {
    assert.equal(
      buildAdminWorkspaceHref(
        "http://localhost:3000/admin/dynamic-beta?token=local-admin&view=compact#drafts",
        "more",
      ),
      "/admin/dynamic-beta?token=local-admin&view=compact&section=more#drafts",
    );
  });

  it("constructs one URL from the supplied current href", () => {
    const NativeURL = globalThis.URL;
    let constructions = 0;
    globalThis.URL = class CountingURL extends NativeURL {
      constructor(...args) {
        constructions += 1;
        super(...args);
      }
    };

    try {
      assert.equal(
        buildAdminWorkspaceHref(
          "http://localhost:3000/admin/dynamic-beta?token=local-admin",
          "briefs",
        ),
        "/admin/dynamic-beta?token=local-admin&section=briefs",
      );
      assert.equal(constructions, 1);
    } finally {
      globalThis.URL = NativeURL;
    }
  });
});

describe("dynamic beta admin workspace navigation", () => {
  it("exposes the same five labeled destinations on desktop and mobile", async () => {
    const AdminWorkspaceNavigation = await loadAdminWorkspaceNavigation();
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(AdminWorkspaceNavigation, {
        activeSection: "today",
        onSelect: () => {},
      }));
    });

    const expectedLabels = ["Today", "Briefs", "Confirmations", "Data", "More"];
    for (const className of ["adminWorkspaceDesktopNav", "adminWorkspaceMobileNav"]) {
      const buttons = navigationButtons(renderer, className);
      assert.equal(buttons.length, 5);
      assert.deepEqual(buttons.map((button) => button.props["aria-label"]), expectedLabels);
    }
  });

  it("marks the active destination as current and selected with a text label", async () => {
    const AdminWorkspaceNavigation = await loadAdminWorkspaceNavigation();
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(AdminWorkspaceNavigation, {
        activeSection: "confirmations",
        onSelect: () => {},
      }));
    });

    const activeTab = navigationButtons(renderer, "adminWorkspaceDesktopNav").find((button) => (
      button.props["aria-label"] === "Confirmations"
    ));
    assert.equal(activeTab.props["aria-selected"], true);
    assert.equal(activeTab.props["aria-current"], "page");
    assert.equal(activeTab.children.join(""), "Confirmations");
  });

  it("uses roving tab focus and selects the keyboard destination", async () => {
    const AdminWorkspaceNavigation = await loadAdminWorkspaceNavigation();
    const selected = [];
    const focused = [];
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(AdminWorkspaceNavigation, {
        activeSection: "today",
        onSelect: (section) => selected.push(section),
      }), {
        createNodeMock(element) {
          if (element.type === "button") {
            return {
              focus() {
                focused.push(element.props["aria-label"]);
              },
            };
          }
          return {};
        },
      });
    });

    const tabs = navigationButtons(renderer, "adminWorkspaceDesktopNav");
    assert.deepEqual(tabs.map((tab) => tab.props.tabIndex), [0, -1, -1, -1, -1]);
    assert.deepEqual(
      tabs.map((tab) => tab.props["aria-controls"]),
      [
        "admin-section-today",
        "admin-section-briefs",
        "admin-section-confirmations",
        "admin-section-data",
        "admin-section-more",
      ],
    );

    const activeTab = tabs[0];
    const keypress = (key) => {
      let prevented = false;
      activeTab.props.onKeyDown({
        key,
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
    };

    keypress("ArrowRight");
    keypress("End");
    keypress("Home");
    keypress("ArrowLeft");
    assert.deepEqual(selected, ["briefs", "more", "today", "more"]);
    assert.deepEqual(focused, ["Briefs", "More", "Today", "More"]);
  });

  it("uses named buttons that select the exact workspace section ID", async () => {
    const AdminWorkspaceNavigation = await loadAdminWorkspaceNavigation();
    const selected = [];
    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(AdminWorkspaceNavigation, {
        activeSection: "today",
        onSelect: (section) => selected.push(section),
      }));
    });

    const dataButton = navigationButtons(renderer, "adminWorkspaceMobileNav").find((button) => (
      button.props["aria-label"] === "Data"
    ));
    assert.equal(dataButton.props.type, "button");
    dataButton.props.onClick();
    assert.deepEqual(selected, ["data"]);
  });
});
