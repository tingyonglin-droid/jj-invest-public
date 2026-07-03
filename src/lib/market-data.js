const TAIWAN_TICKER_PATTERN = /^\d{4,6}[A-Z]?$/i;

export function normalizeTicker(tickerInput) {
  const value = String(tickerInput || "").trim().toUpperCase();
  if (!value) {
    return "";
  }
  if (value.endsWith(".TW") || value.endsWith(".TWO")) {
    return value;
  }
  if (TAIWAN_TICKER_PATTERN.test(value)) {
    return `${value}.TW`;
  }
  return value;
}

export function guessCurrency(normalizedTicker) {
  return String(normalizedTicker || "").toUpperCase().endsWith(".TW")
    ? "TWD"
    : "USD";
}

export function convertQuoteToTwd(quote, usdTwd) {
  if (!quote || typeof quote.price !== "number" || !Number.isFinite(quote.price)) {
    return {
      priceTwd: null,
      error: "沒有可用價格。",
    };
  }

  if (quote.currency === "TWD") {
    return {
      priceTwd: quote.price,
      error: null,
    };
  }

  if (quote.currency === "USD") {
    if (typeof usdTwd !== "number" || !Number.isFinite(usdTwd) || usdTwd <= 0) {
      return {
        priceTwd: null,
        error: "缺少 USD/TWD 匯率，無法換算台幣。",
      };
    }
    return {
      priceTwd: quote.price * usdTwd,
      error: null,
    };
  }

  return {
    priceTwd: null,
    error: `不支援的幣別：${quote.currency || "未知"}`,
  };
}

export function dedupeTickers(tickers) {
  return [...new Set(tickers.map(normalizeTicker).filter(Boolean))];
}

export function toYahooChartSymbol(normalizedTicker) {
  return encodeURIComponent(normalizedTicker);
}

export async function fetchYahooQuote(normalizedTicker) {
  const symbol = toYahooChartSymbol(normalizedTicker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=5d&interval=1d`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    next: {
      revalidate: 60,
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance 回應 ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const close = quote?.close || [];
  const timestamps = result?.timestamp || [];
  const meta = result?.meta || {};

  for (let index = close.length - 1; index >= 0; index -= 1) {
    const price = close[index];
    if (typeof price === "number" && Number.isFinite(price)) {
      const timestamp = timestamps[index];
      const date = timestamp
        ? new Date(timestamp * 1000).toISOString().slice(0, 10)
        : null;
      return {
        price,
        date,
        currency: meta.currency || guessCurrency(normalizedTicker),
        source: "Yahoo Finance",
        error: null,
      };
    }
  }

  throw new Error("Yahoo Finance 沒有回傳可用價格。");
}

export async function fetchUsdTwdRate() {
  const quote = await fetchYahooQuote("TWD=X");
  return {
    usdTwd: quote.price,
    date: quote.date,
    source: quote.source,
    error: null,
  };
}
