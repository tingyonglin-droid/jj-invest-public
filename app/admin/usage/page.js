"use client";

import { useCallback, useEffect, useState } from "react";

import { createUsageChartModel } from "../../../src/lib/usage-chart.js";

function formatMetric(value) {
  return Number(value || 0).toLocaleString("zh-TW");
}

function getTokenFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URL(window.location.href).searchParams.get("token") || "";
}

export default function UsageAdminPage() {
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const chartModel = createUsageChartModel(stats?.trend);

  const refreshStats = useCallback(async () => {
    const token = getTokenFromUrl();

    if (!token) {
      setStatus("error");
      setError("缺少管理 token。");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const response = await fetch(`/api/usage?token=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || `使用統計 API 回應 ${response.status}`);
      }

      setStats(payload);
      setStatus("ready");
    } catch (fetchError) {
      setStats(null);
      setStatus("error");
      setError(fetchError instanceof Error ? fetchError.message : "使用統計讀取失敗。");
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(refreshStats, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refreshStats]);

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="brandLockup">
          <span className="brandGlyph" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <div>
            <p>JJ Invest System</p>
          </div>
        </div>
      </header>

      <section className="appCard usageStatsPanel">
        <div className="positionTitle">
          <strong>匿名使用者數</strong>
          <button
            type="button"
            className="secondaryButton compact"
            onClick={refreshStats}
            disabled={status === "loading"}
          >
            重新整理
          </button>
        </div>

        {error && <p className="usageWarning">{error}</p>}

        <div className="usageStatsGrid">
          <UsageMetric label="總匿名裝置" value={stats?.totalDevices} />
          <UsageMetric label="今日活躍" value={stats?.activeToday} />
          <UsageMetric label="7 日活躍" value={stats?.active7Days} />
          <UsageMetric label="30 日活躍" value={stats?.active30Days} />
          <UsageMetric label="今日開啟" value={stats?.opensToday} />
          <UsageMetric label="總開啟次數" value={stats?.totalOpens} />
        </div>

        <UsageTrendChart
          model={chartModel}
          trend={stats?.trend}
        />

        <p className="hint">
          同一台手機或同一個瀏覽器會用同一個匿名 ID 計為 1 個裝置；重新開啟 app 只會增加開啟次數。
        </p>
      </section>
    </main>
  );
}

function UsageTrendChart({ model, trend }) {
  const latest = trend?.[trend.length - 1];
  const latestDevicePoint = getLastSvgPoint(model.devicePoints);
  const latestOpenPoint = getLastSvgPoint(model.openPoints);

  return (
    <div className="usageTrend">
      <div className="usageTrendHeader">
        <div>
          <span>累積趨勢</span>
          <strong>最近 30 天</strong>
        </div>
        <div className="usageTrendLegend">
          <span className="devices">總匿名裝置</span>
          <span className="opens">總開啟次數</span>
        </div>
      </div>

      <div className="usageTrendCanvas">
        <svg viewBox="0 0 100 100" role="img" aria-label="總匿名裝置與總開啟次數累積曲線">
          <line x1="0" y1="0" x2="100" y2="0" className="chartGrid" />
          <line x1="0" y1="50" x2="100" y2="50" className="chartGrid" />
          <line x1="0" y1="100" x2="100" y2="100" className="chartGrid" />
          {model.devicePoints && (
            <polyline className="chartLine devices" points={model.devicePoints} />
          )}
          {model.openPoints && (
            <polyline className="chartLine opens" points={model.openPoints} />
          )}
          {latestDevicePoint && (
            <circle
              className="chartDot devices"
              cx={latestDevicePoint.x}
              cy={latestDevicePoint.y}
              r="1.8"
            />
          )}
          {latestOpenPoint && (
            <circle
              className="chartDot opens"
              cx={latestOpenPoint.x}
              cy={latestOpenPoint.y}
              r="1.8"
            />
          )}
        </svg>
        <div className="usageTrendScale" aria-hidden="true">
          <span>{formatMetric(model.maxY)}</span>
          <span>0</span>
        </div>
      </div>

      <div className="usageTrendFooter">
        <span>{model.labels[0] || ""}</span>
        <span>{model.labels[1] || model.labels[0] || ""}</span>
      </div>

      {latest && (
        <p className="hint">
          最新累積：總匿名裝置 {formatMetric(latest.totalDevices)}，總開啟次數{" "}
          {formatMetric(latest.totalOpens)}。
        </p>
      )}
    </div>
  );
}

function getLastSvgPoint(points) {
  const lastPoint = String(points || "").trim().split(" ").filter(Boolean).at(-1);
  if (!lastPoint) {
    return null;
  }

  const [x, y] = lastPoint.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function UsageMetric({ label, value }) {
  return (
    <div className="usageMetric">
      <span>{label}</span>
      <strong>{formatMetric(value)}</strong>
    </div>
  );
}
