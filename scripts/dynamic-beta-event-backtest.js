import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDynamicBetaRepository } from "../app/api/dynamic-beta/_shared.js";
import {
  MARKET_RISK_EVENTS,
  runMarketRiskEventBacktest,
} from "../src/lib/dynamic-beta/event-backtest.js";

const SERIES_IDS = [
  "VIXCLS",
  "YAHOO:SPY",
  "YAHOO:QQQ",
  "YAHOO:SOXX",
  "BAMLH0A0HYM2",
  "DGS2",
  "DGS10",
  "UNRATE",
  "PAYEMS",
  "CPILFESL",
  "PCEPILFE",
];

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function createCsv(report) {
  const headers = [
    "event",
    "model",
    "peak_date",
    "trough_date",
    "drawdown_percent",
    "classification",
    "first_cross_40",
    "first_cross_60",
    "lead_trading_days",
    "pre60_score",
    "pre20_score",
    "pre5_score",
    "peak_score",
    "trough_score",
    "pre_event_max_score",
    "pre_event_max_date",
    "through_trough_max_score",
    "top_pre_event_contributors",
  ];
  const rows = [];
  for (const event of report.events) {
    for (const [modelName, model] of [
      ["market-only", event.marketOnly],
      ["full-model", event.fullModel],
    ]) {
      rows.push([
        event.name,
        modelName,
        event.peakDate,
        event.troughDate,
        event.drawdownPercent,
        model.classification,
        model.firstCross40,
        model.firstCross60,
        model.leadTradingDays,
        model.checkpoints.pre60?.score,
        model.checkpoints.pre20?.score,
        model.checkpoints.pre5?.score,
        model.checkpoints.peak?.score,
        model.checkpoints.trough?.score,
        model.preEventMaximum?.score,
        model.preEventMaximum?.date,
        model.throughTroughMaximum?.score,
        model.topPreEventContributors
          .map((item) => `${item.id}:${item.score}`)
          .join(" | "),
      ]);
    }
  }
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

const repository = getDynamicBetaRepository();
if (!repository) {
  throw new Error("缺少 Upstash Redis 設定，無法執行事件回測。");
}

const histories = Object.fromEntries(
  await Promise.all(
    SERIES_IDS.map(async (seriesId) => [
      seriesId,
      await repository.readObservationHistory(seriesId, {
        from: "2018-01-01",
        to: "2025-06-30",
      }),
    ]),
  ),
);
const report = runMarketRiskEventBacktest({
  histories,
  events: MARKET_RISK_EVENTS,
});
const outputDirectory = path.resolve("artifacts/dynamic-beta");
await mkdir(outputDirectory, { recursive: true });
const jsonPath = path.join(outputDirectory, "market-risk-event-backtest-2020-2025.json");
const csvPath = path.join(outputDirectory, "market-risk-event-backtest-2020-2025.csv");
await Promise.all([
  writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(csvPath, `${createCsv(report)}\n`, "utf8"),
]);

console.log(JSON.stringify({ jsonPath, csvPath, events: report.events.length }, null, 2));
