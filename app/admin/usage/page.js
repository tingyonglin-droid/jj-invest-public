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
  const [analyticsStats, setAnalyticsStats] = useState(null);
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
      const [usageResponse, analyticsResponse] = await Promise.all([
        fetch(`/api/usage?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        }),
        fetch(`/api/analytics/admin?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        }),
      ]);
      const payload = await usageResponse.json();
      const analyticsPayload = await analyticsResponse.json();

      if (!usageResponse.ok) {
        throw new Error(payload.error || `使用統計 API 回應 ${usageResponse.status}`);
      }
      if (!analyticsResponse.ok) {
        throw new Error(
          analyticsPayload.error || `Analytics v1 API 回應 ${analyticsResponse.status}`,
        );
      }

      setStats(payload);
      setAnalyticsStats(analyticsPayload);
      setStatus("ready");
    } catch (fetchError) {
      setStats(null);
      setAnalyticsStats(null);
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
          <strong>Legacy 使用統計</strong>
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
          Legacy 統計保留既有匿名裝置與開啟次數，不與 Analytics v1 sessions 混合。
        </p>
      </section>

      <AnalyticsV1Panel stats={analyticsStats} />
    </main>
  );
}

function AnalyticsV1Panel({ stats }) {
  const trend = stats?.trend || [];

  return (
    <section className="appCard usageStatsPanel">
      <div className="positionTitle">
        <strong>Analytics v1</strong>
      </div>
      <p className="hint">開始收集日：{stats?.startDate || "尚未開始"}。時間以台北日期分組。</p>

      <div className="usageStatsGrid">
        <UsageMetric label="總裝置" value={stats?.overview?.totalDevices} />
        <UsageMetric label="今日新增" value={stats?.overview?.todayNewDevices} />
        <UsageMetric label="DAU" value={stats?.overview?.dau} />
        <UsageMetric label="WAU" value={stats?.overview?.wau} />
        <UsageMetric label="MAU" value={stats?.overview?.mau} />
        <UsageMetric label="今日 Sessions" value={stats?.overview?.todaySessions} />
        <UsageMetric label="7 日 Sessions" value={stats?.overview?.sessions7Days} />
        <UsageMetric
          label="每週平均 Sessions"
          value={stats?.overview?.averageWeeklySessionsPerActiveDevice}
          digits={2}
        />
      </div>

      <AnalyticsRetention stats={stats?.retention} />
      <AnalyticsEventUsage events={stats?.events} />
      <AnalyticsVersionUsage versions={stats?.versions} />
      <AnalyticsDailyTrend trend={trend} />
    </section>
  );
}

function formatRatio(value) {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function AnalyticsRetention({ stats }) {
  return (
    <div className="analyticsSection">
      <div className="usageTrendHeader">
        <div>
          <span>留存</span>
          <strong>D1 / D7 / D30 classic exact-day</strong>
        </div>
      </div>
      <div className="analyticsRetentionGrid">
        <UsageMetric label="D1" value={formatRatio(stats?.weighted?.d1?.ratio)} raw />
        <UsageMetric label="D7" value={formatRatio(stats?.weighted?.d7?.ratio)} raw />
        <UsageMetric label="D30" value={formatRatio(stats?.weighted?.d30?.ratio)} raw />
      </div>
      <div className="analyticsTable">
        {(stats?.cohorts || []).slice(-5).map((cohort) => (
          <div key={cohort.date}>
            <span>{cohort.date}</span>
            <span>{cohort.size} 裝置</span>
            <span>D1 {formatRatio(cohort.retention.d1.ratio)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsEventUsage({ events }) {
  return (
    <div className="analyticsSection">
      <div className="usageTrendHeader">
        <div>
          <span>功能使用</span>
          <strong>事件總次數 / 不重複裝置</strong>
        </div>
      </div>
      <div className="analyticsTable">
        {[
          ["beta_calculated", "Beta 計算"],
          ["holding_added", "新增持股"],
          ["holding_deleted", "刪除持股"],
        ].map(([eventName, label]) => (
          <div key={eventName}>
            <span>{label}</span>
            <span>{formatMetric(events?.[eventName]?.totalCount)} 次</span>
            <span>{formatMetric(events?.[eventName]?.uniqueDevices)} 裝置</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsVersionUsage({ versions }) {
  return (
    <div className="analyticsSection">
      <div className="usageTrendHeader">
        <div>
          <span>版本分析</span>
          <strong>活躍裝置 / Sessions / Beta 使用裝置</strong>
        </div>
      </div>
      <div className="analyticsTable">
        {(versions || []).map((item) => (
          <div key={item.version}>
            <span>{item.version}</span>
            <span>{formatMetric(item.activeDevices)} 裝置</span>
            <span>{formatMetric(item.sessions)} Sessions</span>
            <span>{formatMetric(item.betaDevices)} Beta 裝置</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsDailyTrend({ trend }) {
  const latest = trend.at(-1);

  return (
    <div className="analyticsSection">
      <div className="usageTrendHeader">
        <div>
          <span>每日趨勢</span>
          <strong>新增 / 活躍 / Sessions / Beta</strong>
        </div>
      </div>
      <div className="analyticsTable">
        {trend.slice(-7).map((row) => (
          <div key={row.date}>
            <span>{row.date}</span>
            <span>新增 {formatMetric(row.newDevices)}</span>
            <span>活躍 {formatMetric(row.activeDevices)}</span>
            <span>Sessions {formatMetric(row.sessions)}</span>
            <span>Beta {formatMetric(row.betaCalculated)}</span>
          </div>
        ))}
      </div>
      {latest && (
        <p className="hint">
          最新日：新增 {formatMetric(latest.newDevices)}，活躍{" "}
          {formatMetric(latest.activeDevices)}，Sessions {formatMetric(latest.sessions)}。
        </p>
      )}
    </div>
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

function UsageMetric({ label, value, digits = 0, raw = false }) {
  return (
    <div className="usageMetric">
      <span>{label}</span>
      <strong>
        {raw
          ? value
          : Number(value || 0).toLocaleString("zh-TW", {
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
            })}
      </strong>
    </div>
  );
}
