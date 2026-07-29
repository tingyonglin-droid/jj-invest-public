const ADMIN_WORKSPACE_PATH = "/admin/dynamic-beta";

export const ADMIN_WORKSPACE_SECTIONS = Object.freeze([
  Object.freeze({ id: "today", label: "Today" }),
  Object.freeze({ id: "briefs", label: "Briefs" }),
  Object.freeze({ id: "confirmations", label: "Confirmations" }),
  Object.freeze({ id: "data", label: "Data" }),
  Object.freeze({ id: "more", label: "More" }),
]);

const ADMIN_WORKSPACE_SECTION_IDS = new Set(
  ADMIN_WORKSPACE_SECTIONS.map(({ id }) => id),
);

export function normalizeAdminWorkspaceSection(value) {
  return typeof value === "string" && ADMIN_WORKSPACE_SECTION_IDS.has(value)
    ? value
    : "today";
}

export function buildAdminWorkspaceHref(currentHref, section) {
  const currentUrl = new URL(currentHref);
  currentUrl.pathname = ADMIN_WORKSPACE_PATH;
  currentUrl.searchParams.delete("section");
  currentUrl.searchParams.set("section", normalizeAdminWorkspaceSection(section));

  return `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
}
