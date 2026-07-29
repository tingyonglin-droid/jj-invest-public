"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminWorkspaceNavigation from "./AdminWorkspaceNavigation.js";
import TodayWorkspaceSection from "./TodayWorkspaceSection.js";
import BriefsAdminSection from "./BriefsAdminSection.js";
import ConfirmationAdminSection from "./ConfirmationAdminSection.js";
import MarketDataAdminSection from "./MarketDataAdminSection.js";
import AdvancedToolsSection from "./AdvancedToolsSection.js";
import {
  buildAdminWorkspaceHref,
  normalizeAdminWorkspaceSection,
} from "../../../src/lib/dynamic-beta/admin-workspace.js";
import { createDraftPanelController } from "../../../src/lib/dynamic-beta/news/draft-panel-controller.js";

const ADMIN_SECTION_COMPONENTS = Object.freeze({
  today: TodayWorkspaceSection,
  briefs: BriefsAdminSection,
  confirmations: ConfirmationAdminSection,
  data: MarketDataAdminSection,
  more: AdvancedToolsSection,
});

const ADMIN_SECTION_LABELS = Object.freeze({
  today: "Today",
  briefs: "Briefs",
  confirmations: "Confirmations",
  data: "Data",
  more: "More",
});

function sectionFromCurrentUrl() {
  if (typeof window === "undefined") return "today";
  const sections = new URL(window.location.href).searchParams.getAll("section");
  return normalizeAdminWorkspaceSection(sections.length === 1 ? sections[0] : null);
}

export default function DynamicBetaAdminPage() {
  const [activeSection, setActiveSection] = useState(null);
  const draftController = useMemo(() => createDraftPanelController({
    fetchImpl: (...args) => fetch(...args),
    confirmImpl: (...args) => window.confirm(...args),
    promptImpl: (...args) => window.prompt(...args),
  }), []);

  useEffect(() => {
    function restoreSectionFromUrl() {
      setActiveSection(sectionFromCurrentUrl());
    }

    restoreSectionFromUrl();
    window.addEventListener("popstate", restoreSectionFromUrl);
    return () => window.removeEventListener("popstate", restoreSectionFromUrl);
  }, []);

  const selectSection = useCallback((section) => {
    const nextSection = normalizeAdminWorkspaceSection(section);
    const nextHref = buildAdminWorkspaceHref(window.location.href, nextSection);
    window.history.pushState(window.history.state, "", nextHref);
    setActiveSection(nextSection);
  }, []);
  const handleAuthorizationLoss = useCallback((error, requestAccessEpoch) => {
    return draftController.reportAuthorizationLoss(error, requestAccessEpoch);
  }, [draftController]);

  const ActiveSection = activeSection
    ? ADMIN_SECTION_COMPONENTS[activeSection]
    : null;

  return (
    <main className="appShell dynamicBetaAdmin">
      <header className="appHeader">
        <div className="brandLockup">
          <span className="brandGlyph" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <div>
            <h1>JJ Invest System</h1>
          </div>
        </div>
      </header>

      {ActiveSection ? (
        <>
          <AdminWorkspaceNavigation
            activeSection={activeSection}
            onSelect={selectSection}
          />

          <section
            id={`admin-section-${activeSection}`}
            className="appCard adminWorkspacePanel"
            role="tabpanel"
            aria-label={`${ADMIN_SECTION_LABELS[activeSection]} workspace section`}
            tabIndex={0}
          >
            <ActiveSection
              adminAccess={draftController}
              onAuthorizationLoss={handleAuthorizationLoss}
              {...(activeSection === "today" ? { onOpenSection: selectSection } : {})}
              {...(
                activeSection === "today" || activeSection === "briefs"
                  ? { draftController }
                  : {}
              )}
            />
          </section>
        </>
      ) : (
        <section
          className="appCard adminWorkspaceLoading"
          role="status"
          aria-live="polite"
        >
          <p>Loading workspace…</p>
        </section>
      )}
    </main>
  );
}
