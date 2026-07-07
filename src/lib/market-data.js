const TAIWAN_TICKER_PATTERN = /^\d{4,6}[A-Z]?$/i;
const TAIWAN_LISTED_TICKER_PATTERN = /^(\d{4,6}[A-Z]?)\.TW$/i;

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

function formatTwseDate(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) {
    return null;
  }

  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function previousWeekday(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return date.toISOString().slice(0, 10);
}

function parseTwseNumber(value) {
  const number = Number(String(value || "").replaceAll(",", ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function parseTwseQuote(stockInfo) {
  const tradePrice = parseTwseNumber(stockInfo?.z);
  const quotedDate = formatTwseDate(stockInfo?.d);

  if (tradePrice && quotedDate) {
    return {
      price: tradePrice,
      date: quotedDate,
      currency: "TWD",
      source: "TWSE",
      error: null,
    };
  }

  const previousClose = parseTwseNumber(stockInfo?.y);
  const previousDate = quotedDate ? previousWeekday(quotedDate) : null;
  if (previousClose && previousDate) {
    return {
      price: previousClose,
      date: previousDate,
      currency: "TWD",
      source: "TWSE",
      error: null,
    };
  }

  throw new Error("TWSE 沒有回傳可用價格。");
}

export function toTwseChannel(normalizedTicker) {
  const match = String(normalizedTicker || "").toUpperCase().match(TAIWAN_LISTED_TICKER_PATTERN);
  return match ? `tse_${match[1]}.tw` : null;
}

export async function fetchTwseQuote(normalizedTicker) {
  const channel = toTwseChannel(normalizedTicker);
  if (!channel) {
    throw new Error("不是 TWSE 上市股票代號。");
  }

  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channel)}&json=1&delay=0`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    next: {
      revalidate: 60,
    },
  });

  if (!response.ok) {
    throw new Error(`TWSE 回應 ${response.status}`);
  }

  const payload = await response.json();
  const stockInfo = payload?.msgArray?.[0];
  return parseTwseQuote(stockInfo);
}

export async function fetchYahooQuote(normalizedTicker) {
  if (toTwseChannel(normalizedTicker)) {
    try {
      return await fetchTwseQuote(normalizedTicker);
    } catch {
      // Fall through to Yahoo Finance when TWSE is temporarily unavailable.
    }
  }

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
