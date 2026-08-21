import {
  fetchHistoricalQuotes,
  normalizeTicker,
} from "../../../src/lib/market-data.js";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

function parseParams(request) {
  const { searchParams } = new URL(request.url);
  return {
    tickers: String(searchParams.get("tickers") || "")
      .split(",")
      .map((ticker) => ticker.trim())
      .filter(Boolean),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  };
}

function isDateText(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

export async function GET(request) {
  const { tickers, from, to } = parseParams(request);

  if (!tickers.length || !isDateText(from) || !isDateText(to) || from > to) {
    return Response.json(
      {
        quotes: [],
        error: "請提供 tickers、from 與 to，例如 /api/history-quotes?tickers=0050.TW&from=2026-07-01&to=2026-07-23",
      },
      { status: 400 },
    );
  }

  const quotes = await Promise.all(
    tickers.map(async (inputTicker) => {
      const normalizedTicker = normalizeTicker(inputTicker);
      try {
        const prices = await fetchHistoricalQuotes(normalizedTicker, { from, to });
        const usesTwse = prices.some((price) => price.source === "TWSE");
        return {
          inputTicker,
          normalizedTicker,
          prices,
          source: usesTwse ? "TWSE／Yahoo Finance" : "Yahoo Finance",
          error: prices.some((price) => price.error) ? "部分日期缺少歷史收盤價。" : null,
        };
      } catch (error) {
        return {
          inputTicker,
          normalizedTicker,
          prices: [],
          source: null,
          error: error instanceof Error ? error.message : "歷史價格查詢失敗。",
        };
      }
    }),
  );

  return Response.json(
    { quotes },
    {
      headers: {
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
