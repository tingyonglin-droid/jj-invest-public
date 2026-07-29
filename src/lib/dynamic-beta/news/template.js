const TOPICS = [
  "global_macro_fed",
  "energy_geopolitics",
  "megacap_earnings",
  "ai_semiconductors",
  "taiwan_tech_supply_chain",
];

// Replace these catalog-valid examples with analyst-selected rules; they are not inferred.
const confirmationExamples = [
  { seriesId: "DGS2", expectedDirection: "up", changeType: "basis_points", threshold: 5 },
  { seriesId: "YAHOO:CL=F", expectedDirection: "up", changeType: "percent", threshold: 2 },
  { seriesId: "YAHOO:QQQ", expectedDirection: "down", changeType: "percent", threshold: 1 },
  { seriesId: "YAHOO:SOXX", expectedDirection: "down", changeType: "percent", threshold: 1.5 },
  { seriesId: "YAHOO:0050.TW", expectedDirection: "down", changeType: "percent", threshold: 1 },
];

export function createMorningBriefTemplate(
  briefDate = new Date().toISOString().slice(0, 10),
  now = new Date(),
) {
  const generatedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const evidence = TOPICS.map((topic, index) => ({
    url: `https://example.com/replace-with-source-${index + 1}`,
    sourceName: "請填入來源名稱",
    sourceTier: "unknown",
    title: `請填入第 ${index + 1} 則來源標題`,
    summary: null,
    publishedAt: null,
  }));

  return {
    briefDate,
    generatedAt,
    analystLabel: "risk_on",
    analystRationale: "請填入當日綜合判讀；這是人工／AI 分析標籤，不是量化分數。",
    evidence,
    events: TOPICS.map((topicId, index) => ({
      rank: index + 1,
      headline: `請填入第 ${index + 1} 件重要事件`,
      summary: "請填入事件摘要。",
      topicIds: [topicId],
      evidenceUrls: [evidence[index].url],
      transmissionPath: ["請填入起點", "請填入傳導環節", "請填入市場結果"],
      affectedAssets: ["請填入受影響資產"],
      marketDate: briefDate,
      dataToConfirm: [confirmationExamples[index].seriesId],
      confirmationRules: [confirmationExamples[index]],
      interpretation: "請填入投資意義。",
      confidence: 0.5,
      techEarnings: topicId === "megacap_earnings"
        ? {
            company: null,
            revenueGrowthPct: null,
            aiCloudGrowthPct: null,
            capexGrowthPct: null,
            freeCashFlowGrowthPct: null,
            capexGrowingFasterThanFcf: null,
          }
        : null,
    })),
  };
}
