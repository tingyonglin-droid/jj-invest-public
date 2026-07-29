"use client";

import { useRef } from "react";

import {
  ADMIN_WORKSPACE_SECTIONS,
  normalizeAdminWorkspaceSection,
} from "../../../src/lib/dynamic-beta/admin-workspace.js";

export default function AdminWorkspaceNavigation({ activeSection, onSelect }) {
  const selectedSection = normalizeAdminWorkspaceSection(activeSection);
  const tabRefs = useRef([]);

  function selectSection(sectionId) {
    onSelect?.(sectionId);
  }

  function selectDesktopTab(index) {
    const section = ADMIN_WORKSPACE_SECTIONS[index];
    selectSection(section.id);
    tabRefs.current[index]?.focus();
  }

  function handleDesktopTabKeyDown(event, index) {
    let nextIndex;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + ADMIN_WORKSPACE_SECTIONS.length)
          % ADMIN_WORKSPACE_SECTIONS.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % ADMIN_WORKSPACE_SECTIONS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = ADMIN_WORKSPACE_SECTIONS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectDesktopTab(nextIndex);
  }

  return (
    <>
      <nav className="adminWorkspaceDesktopNav" aria-label="Workspace sections">
        <div className="adminWorkspaceTabList" role="tablist" aria-label="Workspace sections">
          {ADMIN_WORKSPACE_SECTIONS.map((section, index) => {
            const isSelected = section.id === selectedSection;
            return (
              <button
                key={section.id}
                ref={(node) => { tabRefs.current[index] = node; }}
                type="button"
                role="tab"
                aria-label={section.label}
                aria-selected={isSelected}
                aria-current={isSelected ? "page" : undefined}
                aria-controls={`admin-section-${section.id}`}
                tabIndex={isSelected ? 0 : -1}
                className={isSelected ? "adminWorkspaceTab isActive" : "adminWorkspaceTab"}
                onClick={() => selectSection(section.id)}
                onKeyDown={(event) => handleDesktopTabKeyDown(event, index)}
              >
                {section.label}
              </button>
            );
          })}
        </div>
      </nav>

      <nav className="adminWorkspaceMobileNav" aria-label="Workspace sections">
        {ADMIN_WORKSPACE_SECTIONS.map((section) => {
          const isSelected = section.id === selectedSection;
          return (
            <button
              key={section.id}
              type="button"
              aria-label={section.label}
              aria-current={isSelected ? "page" : undefined}
              className={isSelected ? "adminWorkspaceMobileItem isActive" : "adminWorkspaceMobileItem"}
              onClick={() => selectSection(section.id)}
            >
              {section.label}
            </button>
          );
        })}
      </nav>
    </>
  );
}
