import {
  convertQuoteToTwd,
  fetchUsdTwdRate,
  fetchYahooQuote,
  normalizeTicker,
} from "../../../src/lib/market-data.js";

export const dynamic = "force-dynamic";
export const revalidate = 60;

function parseTickers(request) {
  const { searchParams } = new URL(request.url);
  return String(searchParams.get("tickers") || "")
    .split(",")
    .map((ticker) => ticker.trim())
    .filter(Boolean);
}

export async function GET(request) {
  const inputTickers = parseTickers(request);

  let fx = {
    usdTwd: null,
    date: null,
    source: null,
    error: null,
  };

  try {
    fx = await fetchUsdTwdRate();
  } catch (error) {
    fx = {
      usdTwd: null,
      date: null,
      source: null,
      error: error instanceof Error ? error.message : "匯率查詢失敗。",
    };
  }

  const quotes = await Promise.all(
    inputTickers.map(async (inputTicker) => {
      const normalizedTicker = normalizeTicker(inputTicker);
      try {
        const quote = await fetchYahooQuote(normalizedTicker);
        const currency = quote.currency || "USD";
        const converted = convertQuoteToTwd(
          {
            price: quote.price,
            currency,
          },
          fx.usdTwd,
        );

        return {
          inputTicker,
          normalizedTicker,
          price: quote.price,
          currency,
          priceTwd: converted.priceTwd,
          date: quote.date,
          source: quote.source,
          error: converted.error,
        };
      } catch (error) {
        return {
          inputTicker,
          normalizedTicker,
          price: null,
          currency: null,
          priceTwd: null,
          date: null,
          source: null,
          error: error instanceof Error ? error.message : "價格查詢失敗。",
        };
      }
    }),
  );

  return Response.json(
    {
      quotes,
      fx,
    },
    {
      headers: {
        "Cache-Control": "s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}
