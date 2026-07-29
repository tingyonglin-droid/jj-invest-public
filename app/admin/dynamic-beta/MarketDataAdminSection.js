"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAdminAccessLifecycle } from "./useAdminAccessLifecycle.js";

import {
  formatDynamicBetaValue,
  getDynamicBetaFreshnessLabel,
  getDynamicBetaStatusLabel,
  summarizeDynamicBetaSeries,
} from "../../../src/lib/dynamic-beta/admin-view.js";
import {
  isAdminAccessDenied,
  readAdminJson,
} from "../../../src/lib/dynamic-beta/admin-http.js";

const SUMMARY_ITEMS = Object.freeze([
  ["fresh", "新鮮"],
  ["delayed", "延遲"],
  ["stale", "過期"],
  ["never", "無資料"],
  ["error", "同步失敗"],
]);

function getAdminToken() {
  if (typeof window === "undefined") return "";
  return new URL(window.location.href).searchParams.get("token") || "";
}

function beginAccessRequest(adminAccess) {
  return typeof adminAccess?.beginAccessRequest === "function"
    ? adminAccess.beginAccessRequest()
    : undefined;
}

function isAccessRequestCurrent(adminAccess, requestAccessEpoch) {
  return typeof adminAccess?.isAccessRequestCurrent !== "function"
    || adminAccess.isAccessRequestCurrent(requestAccessEpoch);
}

function completeValidatedAccess(adminAccess, requestAccessEpoch) {
  return typeof adminAccess?.completeValidatedAccess !== "function"
    || adminAccess.completeValidatedAccess(requestAccessEpoch);
}

function reportAuthorizationLoss({
  adminAccess,
  onAuthorizationLoss,
  error,
  requestAccessEpoch,
}) {
  if (typeof onAuthorizationLoss === "function") {
    return onAuthorizationLoss(error, requestAccessEpoch) !== false;
  }
  if (typeof adminAccess?.reportAuthorizationLoss === "function") {
    return adminAccess.reportAuthorizationLoss(error, requestAccessEpoch);
  }
  return true;
}

function formatTime(value) {
  if (!value) return "沒有資料";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

function hasNeverSynced(item) {
  return item.freshnessStatus === "never" || item.updateStatus === "never";
}

function formatLatestValue(item) {
  if (item.latestValue === null || item.latestValue === undefined) {
    return "沒有資料";
  }
  const value = formatDynamicBetaValue(item.latestValue);
  return item.unit ? `${value} ${item.unit}` : value;
}

function formatRetrievedTime(item) {
  if (!item.retrievedAt && hasNeverSynced(item)) return "尚未同步";
  return formatTime(item.retrievedAt);
}

function formatVintage(item) {
  if (!item.observationDate && hasNeverSynced(item)) return "尚未同步";
  const vintageStart = item.sourceRealtimeStart;
  const vintageEnd = item.sourceRealtimeEnd;
  const vintage = vintageStart
    ? `${vintageStart}${vintageEnd && vintageEnd !== vintageStart ? ` – ${vintageEnd}` : ""}`
    : "";
  const released = item.releasedAt ? formatTime(item.releasedAt) : "";

  if (!vintage && !released) return "來源未提供 released/vintage";
  if (!vintage) return `Released: ${released}；來源未提供 vintage`;
  if (!released) return `Vintage: ${vintage}；來源未提供 released`;
  return `Vintage: ${vintage}；Released: ${released}`;
}

function formatSeenRange(item) {
  if (!item.firstSeenAt && !item.lastSeenAt) {
    return hasNeverSynced(item) ? "尚未同步" : "沒有資料";
  }
  return `${formatTime(item.firstSeenAt)} → ${formatTime(item.lastSeenAt)}`;
}

function DataCard({ item, alert = false }) {
  return (
    <article
      className={`marketDataCard${alert ? " marketDataAlertCard" : ""}`}
      data-freshness-status={item.freshnessStatus}
    >
      <header>
        <div>
          <h3>{item.name || item.seriesId}</h3>
          <code>{item.seriesId}</code>
        </div>
        <strong>{getDynamicBetaFreshnessLabel(item.freshnessStatus)}</strong>
      </header>
      <dl>
        <div>
          <dt>最新值</dt>
          <dd>{formatLatestValue(item)}</dd>
        </div>
        <div>
          <dt>Observation date</dt>
          <dd>{item.observationDate || "沒有資料"}</dd>
        </div>
        <div>
          <dt>新鮮度原因</dt>
          <dd>{item.freshnessReason || "沒有資料"}</dd>
        </div>
        <div>
          <dt>Retrieved</dt>
          <dd>{formatRetrievedTime(item)}</dd>
        </div>
        <div>
          <dt>Released / vintage</dt>
          <dd>{formatVintage(item)}</dd>
        </div>
        <div>
          <dt>來源</dt>
          <dd>{item.source || "沒有資料"}</dd>
        </div>
        <div>
          <dt>更新狀態</dt>
          <dd title={item.error || ""}>
            {getDynamicBetaStatusLabel(item.updateStatus)}
            {item.error ? `：${item.error}` : ""}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function DataTable({ series }) {
  return (
    <div className="adminWideTableScroll">
      <table className="analyticsTable marketDataDesktopTable">
        <caption>市場資料明細</caption>
        <thead>
          <tr>
            <th scope="col">指標</th>
            <th scope="col">最新值</th>
            <th scope="col">Observation</th>
            <th scope="col">新鮮度</th>
            <th scope="col">Vintage</th>
            <th scope="col">Retrieved</th>
            <th scope="col">來源</th>
            <th scope="col">狀態</th>
          </tr>
        </thead>
        <tbody>
          {series.map((item) => (
            <tr key={item.seriesId}>
              <th scope="row">
                {item.name || item.seriesId}
                <br />
                <code>{item.seriesId}</code>
              </th>
              <td>{formatLatestValue(item)}</td>
              <td>{item.observationDate || "沒有資料"}</td>
              <td title={item.freshnessReason || ""}>
                {getDynamicBetaFreshnessLabel(item.freshnessStatus)}
                <br />
                <small>{item.freshnessReason || "沒有資料"}</small>
              </td>
              <td>
                {formatVintage(item)}
                <br />
                <small>Seen: {formatSeenRange(item)}</small>
              </td>
              <td>{formatRetrievedTime(item)}</td>
              <td>{item.source || "沒有資料"}</td>
              <td title={item.error || ""}>
                {getDynamicBetaStatusLabel(item.updateStatus)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketDataAdminSection({
  adminAccess = null,
  onAuthorizationLoss = null,
}) {
  const [series, setSeries] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [syncSummary, setSyncSummary] = useState("");
  const hasSuccessfulResult = useRef(false);

  useAdminAccessLifecycle(adminAccess, {
    onAccessDenied(snapshot) {
      setSeries([]);
      setStatus("error");
      setError(snapshot.error || "管理權限已失效。");
      setStale(false);
      setHasLoaded(false);
      setSyncSummary("");
      hasSuccessfulResult.current = false;
    },
  });

  const loadData = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    const token = getAdminToken();
    if (!token) {
      setError("缺少管理 token。");
      setStatus("error");
      setSeries([]);
      setHasLoaded(false);
      hasSuccessfulResult.current = false;
      setStale(false);
      setSyncSummary("");
      return;
    }

    setStatus("loading");
    setError("");
    try {
      const response = await fetch(
        `/api/dynamic-beta/admin?token=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      const payload = await readAdminJson(response, {
        fallbackMessage: "市場資料讀取失敗。",
        validate: (value) => Boolean(value)
          && typeof value === "object"
          && Array.isArray(value.series),
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      setSeries(payload.series);
      hasSuccessfulResult.current = true;
      setHasLoaded(true);
      setStale(false);
      setStatus("ready");
    } catch (loadError) {
      if (loadError?.kind === "authorization") {
        const accepted = reportAuthorizationLoss({
          adminAccess,
          onAuthorizationLoss,
          error: loadError,
          requestAccessEpoch,
        });
        if (!accepted) return null;
      } else if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) {
        return null;
      }
      setError(loadError instanceof Error ? loadError.message : "資料讀取失敗。");
      setStatus("error");
      if (isAdminAccessDenied(loadError)) {
        setSeries([]);
        setHasLoaded(false);
        hasSuccessfulResult.current = false;
        setStale(false);
        setSyncSummary("");
      } else {
        setStale(hasSuccessfulResult.current);
      }
    }
  }, [adminAccess, onAuthorizationLoss]);

  const runSync = useCallback(async () => {
    const requestAccessEpoch = beginAccessRequest(adminAccess);
    const token = getAdminToken();
    if (!token) {
      setError("缺少管理 token。");
      setStatus("error");
      setSeries([]);
      setHasLoaded(false);
      hasSuccessfulResult.current = false;
      setStale(false);
      setSyncSummary("");
      return;
    }

    setStatus("syncing");
    setError("");
    setSyncSummary("");
    try {
      const response = await fetch(
        `/api/dynamic-beta/sync?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const payload = await readAdminJson(response, {
        fallbackMessage: "市場資料同步失敗。",
        validate: (value) => Boolean(value)
          && typeof value === "object"
          && Array.isArray(value.results),
      });
      if (!completeValidatedAccess(adminAccess, requestAccessEpoch)) return null;
      const failures = payload.results.filter(
        (result) => result.status === "error",
      ).length;
      setSyncSummary(
        `同步完成：${payload.results.length} 個 series，${failures} 個失敗。`,
      );
      await loadData();
    } catch (syncError) {
      if (syncError?.kind === "authorization") {
        const accepted = reportAuthorizationLoss({
          adminAccess,
          onAuthorizationLoss,
          error: syncError,
          requestAccessEpoch,
        });
        if (!accepted) return null;
      } else if (!isAccessRequestCurrent(adminAccess, requestAccessEpoch)) {
        return null;
      }
      setError(syncError instanceof Error ? syncError.message : "資料同步失敗。");
      setStatus("error");
      if (isAdminAccessDenied(syncError)) {
        setSeries([]);
        setHasLoaded(false);
        hasSuccessfulResult.current = false;
        setStale(false);
        setSyncSummary("");
      } else {
        setStale(hasSuccessfulResult.current);
      }
    }
  }, [adminAccess, loadData, onAuthorizationLoss]);

  useEffect(() => {
    const timeoutId = window.setTimeout(loadData, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  const summary = summarizeDynamicBetaSeries(series);
  const busy = status === "loading" || status === "syncing";

  return (
    <section
      className="marketDataAdminSection"
      aria-labelledby="market-data-title"
      aria-busy={busy}
    >
      <div className="positionTitle marketDataHeader">
        <div>
          <h2 id="market-data-title">市場資料</h2>
          <p className="hint">異常資料優先顯示；新鮮度沿用既有判定。</p>
        </div>
        <div className="marketDataControls">
          <button
            type="button"
            className="secondaryButton compact"
            onClick={loadData}
            disabled={busy}
          >
            {status === "loading" ? "讀取中…" : "重新整理"}
          </button>
          <button
            type="button"
            className="secondaryButton compact"
            onClick={runSync}
            disabled={busy}
          >
            {status === "syncing" ? "同步中…" : "手動同步"}
          </button>
        </div>
      </div>

      <div aria-live="polite">
        {busy && (
          <p role="status">
            {status === "syncing" ? "市場資料同步中" : "市場資料讀取中"}
          </p>
        )}
        {error && <p className="usageWarning">{error}</p>}
        {stale && <p className="hint">顯示上次成功讀取結果</p>}
        {syncSummary && <p className="hint">{syncSummary}</p>}
      </div>

      {hasLoaded && (
        <>
      <dl className="marketDataSummary" aria-label="市場資料新鮮度摘要">
        {SUMMARY_ITEMS.map(([freshnessStatus, label]) => (
          <div key={freshnessStatus} data-freshness-status={freshnessStatus}>
            <dt>{label}</dt>
            <dd>{summary.counts[freshnessStatus]}</dd>
          </div>
        ))}
      </dl>

      <div className="marketDataAlerts" aria-label="異常市場資料">
        {summary.alerts.map((item) => (
          <DataCard item={item} alert key={item.seriesId} />
        ))}
        {summary.alerts.length === 0 && status !== "loading" && (
          <p className="hint">目前沒有異常資料。</p>
        )}
      </div>

      <details className="marketDataNormalDisclosure" aria-label="所有正常資料">
        <summary>所有正常資料（{summary.counts.fresh}）</summary>
        <div className="marketDataNormalContent">
          <DataTable series={summary.normal} />
          <div className="marketDataMobileCards">
            {summary.normal.map((item) => (
              <DataCard item={item} key={item.seriesId} />
            ))}
          </div>
          {summary.normal.length === 0 && <p className="hint">沒有資料</p>}
        </div>
      </details>
        </>
      )}
    </section>
  );
}
