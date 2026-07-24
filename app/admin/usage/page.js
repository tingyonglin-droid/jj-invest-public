"use client";

import { useCallback, useEffect, useState } from "react";

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
  const [analyticsStats, setAnalyticsStats] = useState(null);
  const [analyticsStatus, setAnalyticsStatus] = useState("idle");
  const [analyticsError, setAnalyticsError] = useState("");

  const loadAnalyticsStats = useCallback(async () => {
    const token = getTokenFromUrl();

    if (!token) {
      setAnalyticsStatus("error");
      setAnalyticsError("缺少管理 token。");
      return;
    }

    setAnalyticsStatus("loading");
    setAnalyticsError("");

    try {
      const analyticsResponse = await fetch(
        `/api/analytics/admin?token=${encodeURIComponent(token)}`,
        {
          cache: "no-store",
        },
      );
      const analyticsPayload = await analyticsResponse.json();

      if (!analyticsResponse.ok) {
        throw new Error(
          analyticsPayload.error || `Analytics v1 API 回應 ${analyticsResponse.status}`,
        );
      }

      setAnalyticsStats(analyticsPayload);
      setAnalyticsStatus("ready");
    } catch (fetchError) {
      setAnalyticsStats(null);
      setAnalyticsStatus("error");
      setAnalyticsError(fetchError instanceof Error ? fetchError.message : "Analytics v1 讀取失敗。");
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(loadAnalyticsStats, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadAnalyticsStats]);

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

      <AnalyticsV1Panel
        stats={analyticsStats}
        status={analyticsStatus}
        error={analyticsError}
        onRefresh={loadAnalyticsStats}
      />
    </main>
  );
}

function AnalyticsV1Panel({ stats, status, error, onRefresh }) {
  const trend = stats?.trend || [];

  return (
    <section className="appCard usageStatsPanel">
      <div className="positionTitle">
        <strong>Analytics v1</strong>
        <button
          type="button"
          className="secondaryButton compact"
          onClick={onRefresh}
          disabled={status === "loading"}
        >
          重新整理
        </button>
      </div>
      {error && <p className="usageWarning">{error}</p>}
      <p className="hint">開始收集日：{stats?.startDate || "尚未開始"}。時間以台北日期分組。</p>

      <div className="usageStatsGrid">
        <UsageMetric label="總裝置" value={stats?.overview?.totalDevices} />
        <UsageMetric label="今日新增" value={stats?.overview?.todayNewDevices} />
        <UsageMetric label="DAU" value={stats?.overview?.dau} />
        <UsageMetric label="WAU" value={stats?.overview?.wau} />
        <UsageMetric label="MAU" value={stats?.overview?.mau} />
        <UsageMetric
          label="有效使用裝置"
          value={stats?.events?.portfolio_completed?.uniqueDevices}
        />
        <UsageMetric
          label="今日有效使用"
          value={stats?.events?.portfolio_completed?.todayCount}
        />
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
          ["portfolio_completed", "有效使用"],
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
          <strong>活躍裝置 / Sessions / 有效使用裝置 / Beta 使用裝置</strong>
        </div>
      </div>
      <div className="analyticsTable">
        {(versions || []).map((item) => (
          <div key={item.version}>
            <span>{item.version}</span>
            <span>{formatMetric(item.activeDevices)} 裝置</span>
            <span>{formatMetric(item.sessions)} Sessions</span>
            <span>{formatMetric(item.completedDevices)} 有效裝置</span>
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
          <strong>新增 / 活躍 / Sessions / 有效使用 / Beta</strong>
        </div>
      </div>
      <div className="analyticsTable">
        {trend.slice(-7).map((row) => (
          <div key={row.date}>
            <span>{row.date}</span>
            <span>新增 {formatMetric(row.newDevices)}</span>
            <span>活躍 {formatMetric(row.activeDevices)}</span>
            <span>Sessions {formatMetric(row.sessions)}</span>
            <span>有效 {formatMetric(row.portfolioCompleted)}</span>
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
