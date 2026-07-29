import { summarizeDynamicBetaSeries } from "./admin-view.js";
import { buildPublishedBriefPresentation } from "./news/brief-presentation.js";
import { summarizeConfirmationResult } from "./news/confirmation-admin-state.js";
import { buildDraftPreview } from "./news/draft-panel-controller.js";

function numericTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function newestDraft(drafts) {
  return [...drafts].sort((left, right) => (
    String(right?.briefDate || "").localeCompare(String(left?.briefDate || ""))
    || Number(right?.draftRevisionNumber || 0) - Number(left?.draftRevisionNumber || 0)
    || numericTime(right?.updatedAt || right?.createdAt)
      - numericTime(left?.updatedAt || left?.createdAt)
  ))[0] || null;
}

function newestBrief(briefs) {
  return [...briefs].sort((left, right) => (
    String(right?.briefDate || "").localeCompare(String(left?.briefDate || ""))
    || Number(right?.revisionNumber || 0) - Number(left?.revisionNumber || 0)
    || numericTime(right?.generatedAt) - numericTime(left?.generatedAt)
  ))[0] || null;
}

function trackingStage(result) {
  const events = Array.isArray(result?.events) ? result.events : [];
  if (!events.length) return "no_events";
  if (events.some((event) => event?.d1?.isFinal === false)) return "d1_tracking";
  if (events.some((event) => (
    event?.d3?.isFinal === false || event?.persistence === "observing"
  ))) return "d3_tracking";
  return "complete";
}

function compactEvents(brief) {
  return (Array.isArray(brief?.events) ? brief.events : [])
    .slice(0, 5)
    .map((event) => ({
      rank: event?.rank ?? null,
      headline: event?.headline || null,
      summary: event?.summary || null,
    }));
}

export function buildTodayWorkspaceModel({
  drafts = [],
  briefs = [],
  confirmationResult = null,
  series = [],
} = {}) {
  const safeDrafts = Array.isArray(drafts) ? drafts : [];
  const safeBriefs = Array.isArray(briefs) ? briefs : [];
  const safeSeries = Array.isArray(series) ? series : [];
  const selectedDraft = newestDraft(safeDrafts);
  const draft = buildDraftPreview(selectedDraft);
  const mappedBrief = selectedDraft?.approvedBriefRevisionId
    ? safeBriefs.find((brief) => (
      brief?.revisionId === selectedDraft.approvedBriefRevisionId
    )) || null
    : null;
  const selectedBrief = mappedBrief || newestBrief(safeBriefs);
  const brief = buildPublishedBriefPresentation(selectedBrief);
  const compactSource = mappedBrief ? brief : draft?.content || brief;
  const confirmation = summarizeConfirmationResult(confirmationResult);
  const market = summarizeDynamicBetaSeries(safeSeries);

  return {
    draft: draft || { emptyState: "目前沒有晨報草稿。" },
    brief: brief || { emptyState: "目前沒有已發布晨報。" },
    eventSummaries: compactEvents(compactSource),
    confirmation: confirmation
      ? {
        ...confirmation,
        stage: trackingStage(confirmationResult),
        emptyState: null,
      }
      : {
        stage: "unavailable",
        emptyState: "目前沒有市場確認結果。",
      },
    market: {
      ...market,
      emptyState: safeSeries.length ? null : "目前沒有市場資料。",
      alertEmptyState: safeSeries.length && !market.alerts.length
        ? "目前沒有異常市場資料。"
        : null,
    },
  };
}
