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
  const [stats, setStats] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

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

        <p className="hint">
          同一台手機或同一個瀏覽器會用同一個匿名 ID 計為 1 個裝置；重新開啟 app 只會增加開啟次數。
        </p>
      </section>
    </main>
  );
}

function UsageMetric({ label, value }) {
  return (
    <div className="usageMetric">
      <span>{label}</span>
      <strong>{formatMetric(value)}</strong>
    </div>
  );
}
