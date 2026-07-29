export const NEWS_TOPIC_DEFINITIONS = Object.freeze([
  {
    id: "global_macro_fed",
    name: "Global Macro / Fed",
    keywords: ["fed", "fomc", "federal reserve", "聯準會", "央行", "monetary policy"],
  },
  {
    id: "inflation_rates",
    name: "Inflation / Rates",
    keywords: ["inflation", "cpi", "pce", "yield", "rates", "通膨", "殖利率", "利率"],
  },
  {
    id: "credit_liquidity",
    name: "Credit / Liquidity",
    keywords: ["credit", "liquidity", "high yield", "spread", "信用", "流動性"],
  },
  {
    id: "energy_geopolitics",
    name: "Energy / Geopolitics",
    keywords: ["oil", "brent", "wti", "war", "sanction", "原油", "戰爭", "制裁"],
  },
  {
    id: "ai_semiconductors",
    name: "AI / Semiconductors",
    keywords: ["ai", "artificial intelligence", "semiconductor", "chip", "gpu", "半導體", "晶片"],
  },
  {
    id: "data_centers",
    name: "Data Centers",
    keywords: ["data center", "datacenter", "cloud", "資料中心", "雲端"],
  },
  {
    id: "megacap_earnings",
    name: "Megacap Earnings",
    keywords: ["earnings", "revenue", "capex", "free cash flow", "microsoft", "meta", "amazon", "google", "apple", "財報", "資本支出", "自由現金流"],
  },
  {
    id: "taiwan_tech_supply_chain",
    name: "Taiwan Tech Supply Chain",
    keywords: ["taiwan", "tsmc", "台灣", "台股", "台積電", "供應鏈"],
  },
  {
    id: "market_stress",
    name: "Market Stress",
    keywords: ["vix", "selloff", "crash", "drawdown", "volatility", "恐慌", "崩盤", "波動"],
  },
]);

export const NEWS_TOPIC_IDS = Object.freeze(
  NEWS_TOPIC_DEFINITIONS.map((topic) => topic.id),
);

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(text, keyword) {
  if (/\p{Script=Han}/u.test(keyword)) return text.includes(keyword);
  const escaped = escapeRegularExpression(keyword);
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
    "u",
  ).test(text);
}

export function suggestNewsTopics(text) {
  const normalized = String(text || "").toLocaleLowerCase("en-US");
  if (!normalized) return [];
  return NEWS_TOPIC_DEFINITIONS
    .filter((topic) => topic.keywords.some((keyword) => containsKeyword(normalized, keyword)))
    .map((topic) => topic.id);
}
