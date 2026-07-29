import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDynamicBetaRepository } from "../app/api/dynamic-beta/_shared.js";
import { MARKET_RISK_EVENTS } from "../src/lib/dynamic-beta/event-backtest.js";
import { runCrashEventForensics } from "../src/lib/dynamic-beta/event-forensics.js";

const SERIES_IDS = [
  "VIXCLS", "YAHOO:SPY", "YAHOO:QQQ", "YAHOO:SOXX",
  "BAMLH0A0HYM2", "DGS2", "DGS10", "UNRATE", "PAYEMS",
  "CPILFESL", "PCEPILFE",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(report) {
  const header = [
    "event", "peak_date", "trough_date", "drawdown_percent", "signal_id",
    "signal_name", "category", "classification", "first_anomaly",
    "lead_trading_days", "anomaly_days_before_peak", "recovered_before_peak",
    "control_anomaly_rate", "pre60_score", "pre40_score", "pre20_score",
    "pre10_score", "pre5_score", "peak_score", "trough_score",
    "pre5_risk_percentile_1y", "peak_risk_percentile_1y",
  ];
  const rows = [];
  for (const event of report.events) {
    for (const signal of event.signals) {
      rows.push([
        event.name, event.peakDate, event.troughDate, event.drawdownPercent,
        signal.id, signal.name, signal.category, signal.classification,
        signal.firstAnomaly, signal.leadTradingDays,
        signal.anomalyDaysBeforePeak, signal.recoveredBeforePeak,
        signal.controlAnomalyRate, signal.checkpoints.pre60?.score,
        signal.checkpoints.pre40?.score, signal.checkpoints.pre20?.score,
        signal.checkpoints.pre10?.score, signal.checkpoints.pre5?.score,
        signal.checkpoints.peak?.score, signal.checkpoints.trough?.score,
        signal.checkpoints.pre5?.riskPercentile1y,
        signal.checkpoints.peak?.riskPercentile1y,
      ]);
    }
  }
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function createMarkdown(report) {
  const lines = [
    "# Crash Event Indicator Forensics",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "> Research-only. Macro history uses revised values with conservative release lags; this is not a complete point-in-time backtest.",
    "",
  ];
  for (const event of report.events) {
    lines.push(
      `## ${event.name}`,
      "",
      `SPY peak ${event.peakDate}; trough ${event.troughDate}; drawdown ${event.drawdownPercent}%.`,
      "",
      `Matched controls: ${event.matchedControls.map((item) => item.date).join(", ")}`,
      "",
      "| Signal | Classification | First anomaly | Lead days | Pre-5 | Peak | Trough | Control anomaly |",
      "|---|---|---:|---:|---:|---:|---:|---:|",
    );
    for (const signal of event.signals) {
      lines.push(
        `| ${signal.name} | ${signal.classification} | ${signal.firstAnomaly || "—"} | ${signal.leadTradingDays ?? "—"} | ${signal.checkpoints.pre5?.score ?? "—"} | ${signal.checkpoints.peak?.score ?? "—"} | ${signal.checkpoints.trough?.score ?? "—"} | ${signal.controlAnomalyRate === null ? "—" : `${(signal.controlAnomalyRate * 100).toFixed(0)}%`} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "## Cross-event ranking",
    "",
    "| Signal | Leading events | Weak leading | Concurrent | Insufficient | Avg lead | Avg control anomaly |",
    "|---|---:|---:|---:|---:|---:|---:|",
  );
  for (const item of report.rankings) {
    lines.push(
      `| ${item.name} | ${item.leadingEvents} | ${item.weakLeadingEvents} | ${item.concurrentEvents} | ${item.insufficientEvents} | ${item.averageLeadTradingDays ?? "—"} | ${item.averageControlAnomalyRate === null ? "—" : `${(item.averageControlAnomalyRate * 100).toFixed(0)}%`} |`,
    );
  }
  lines.push("", "## Data gaps", "", "| Data | Purpose | Priority | Current source |", "|---|---|---:|---|");
  for (const gap of report.dataGaps) {
    lines.push(`| ${gap.name} | ${gap.purpose} | ${gap.priority} | ${gap.currentSource || "none"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

const repository = getDynamicBetaRepository();
if (!repository) throw new Error("缺少 Upstash Redis 設定，無法執行事件鑑識。");

const histories = Object.fromEntries(
  await Promise.all(SERIES_IDS.map(async (seriesId) => [
    seriesId,
    await repository.readObservationHistory(seriesId, {
      from: "2018-01-01",
      to: "2025-06-30",
    }),
  ])),
);
const report = runCrashEventForensics({ histories, events: MARKET_RISK_EVENTS });
const directory = path.resolve("artifacts/dynamic-beta");
await mkdir(directory, { recursive: true });
const base = path.join(directory, "crash-event-indicator-forensics-2020-2025");
await Promise.all([
  writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(`${base}.csv`, `${createCsv(report)}\n`, "utf8"),
  writeFile(`${base}.md`, `${createMarkdown(report)}\n`, "utf8"),
]);
console.log(JSON.stringify({
  jsonPath: `${base}.json`, csvPath: `${base}.csv`, markdownPath: `${base}.md`,
  events: report.events.length, controls: report.controlCandidateCount,
}, null, 2));
