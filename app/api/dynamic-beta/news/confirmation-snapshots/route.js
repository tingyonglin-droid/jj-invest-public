import {
  authorizeDynamicBetaRequest,
  dynamicBetaUnconfiguredResponse,
  getDynamicBetaConfirmationSnapshotRepository,
  getDynamicBetaNewsRepository,
  requireDynamicBetaDataEnabled,
  requireDynamicBetaNewsDataEnabled,
} from "../../_shared.js";

export const dynamic = "force-dynamic";

function validDateKey(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function notFoundResponse() {
  return Response.json({ error: "找不到指定的 Confirmation snapshot。" }, { status: 404 });
}

export function createConfirmationSnapshotGet({
  authorize = authorizeDynamicBetaRequest,
  requireMarketData = requireDynamicBetaDataEnabled,
  requireNewsData = requireDynamicBetaNewsDataEnabled,
  getSnapshotRepository = getDynamicBetaConfirmationSnapshotRepository,
  getNewsRepository = getDynamicBetaNewsRepository,
} = {}) {
  return async function getConfirmationSnapshot(request) {
    const unauthorized = authorize(request);
    if (unauthorized) return unauthorized;
    const marketDisabled = requireMarketData();
    if (marketDisabled) return marketDisabled;
    const newsDisabled = requireNewsData();
    if (newsDisabled) return newsDisabled;

    const url = new URL(request.url);
    const briefDate = url.searchParams.get("briefDate");
    const revisionId = url.searchParams.get("revisionId");
    const asOf = url.searchParams.get("asOf");
    if (!validDateKey(briefDate) || !validDateKey(asOf)) {
      return Response.json(
        { error: "briefDate 與 asOf 必須使用有效的 YYYY-MM-DD。" },
        { status: 400 },
      );
    }
    if (revisionId && !briefDate) {
      return Response.json(
        { error: "revisionId 必須搭配 briefDate。" },
        { status: 400 },
      );
    }

    const snapshotRepository = getSnapshotRepository();
    const newsRepository = getNewsRepository();
    if (!snapshotRepository || !newsRepository) {
      return dynamicBetaUnconfiguredResponse("缺少 Upstash Redis 設定。");
    }

    try {
      if (!briefDate) {
        const snapshots = await snapshotRepository.readRecentLatestSnapshots({
          since: "1900-01-01",
          until: asOf || "9999-12-31",
          limit: 1,
        });
        return snapshots[0] ? Response.json(snapshots[0]) : notFoundResponse();
      }

      let resolvedRevisionId = revisionId;
      if (!resolvedRevisionId) {
        const brief = await newsRepository.readMorningBrief({ briefDate });
        if (!brief) {
          return Response.json(
            { error: "找不到指定的 morning brief。" },
            { status: 404 },
          );
        }
        resolvedRevisionId = brief.revisionId;
      }
      const snapshot = await snapshotRepository.readLatestSnapshot({
        briefDate,
        revisionId: resolvedRevisionId,
        asOf: asOf || undefined,
      });
      return snapshot ? Response.json(snapshot) : notFoundResponse();
    } catch {
      return Response.json(
        { error: "Confirmation snapshot 讀取失敗。" },
        { status: 500 },
      );
    }
  };
}

export const GET = createConfirmationSnapshotGet();
