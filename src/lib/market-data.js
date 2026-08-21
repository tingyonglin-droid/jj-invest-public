const TAIWAN_TICKER_PATTERN = /^\d{4,6}[A-Z]?$/i;
const TAIWAN_LISTED_TICKER_PATTERN = /^(\d{4,6}[A-Z]?)\.TW$/i;
const TAIWAN_EXCHANGE_TICKER_PATTERN = /^(\d{4,6}[A-Z]?)\.(?:TW|TWO)$/i;

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

export function createDateRange(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

export function parseYahooHistoricalPrices(payload, normalizedTicker) {
  const result = payload?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const close = quote?.close || [];
  const timestamps = result?.timestamp || [];
  const meta = result?.meta || {};

  return timestamps
    .map((timestamp, index) => {
      const price = close[index];
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
        return null;
      }

      return {
        date: new Date(timestamp * 1000).toISOString().slice(0, 10),
        price,
        currency: meta.currency || guessCurrency(normalizedTicker),
        source: "Yahoo Finance",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseTwseHistoricalDate(value) {
  const match = String(value || "").match(/^(\d{3})\/(\d{2})\/(\d{2})$/);
  if (!match) {
    return null;
  }

  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
}

export function parseTwseHistoricalPrices(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const dateIndex = fields.indexOf("日期");
  const closeIndex = fields.indexOf("收盤價");

  if (dateIndex < 0 || closeIndex < 0 || !Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((row) => {
      const date = parseTwseHistoricalDate(row?.[dateIndex]);
      const price = parseTwseNumber(row?.[closeIndex]);
      if (!date || !price) {
        return null;
      }

      return {
        date,
        price,
        currency: "TWD",
        source: "TWSE",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeHistoricalPriceObservations(prices, officialPrices) {
  const priceByDate = new Map();
  [...(Array.isArray(prices) ? prices : []), ...(Array.isArray(officialPrices) ? officialPrices : [])]
    .forEach((price) => {
      if (price?.date && Number.isFinite(Number(price.price)) && Number(price.price) > 0) {
        priceByDate.set(price.date, price);
      }
    });

  return [...priceByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function alignHistoricalPricesToDates(prices, dates) {
  const sortedPrices = [...(Array.isArray(prices) ? prices : [])]
    .filter((price) => price?.date && Number.isFinite(Number(price.price)))
    .sort((a, b) => a.date.localeCompare(b.date));

  let priceIndex = 0;
  let latestPrice = null;

  return dates.map((date) => {
    while (
      priceIndex < sortedPrices.length &&
      sortedPrices[priceIndex].date <= date
    ) {
      latestPrice = sortedPrices[priceIndex];
      priceIndex += 1;
    }

    return {
      date,
      price: latestPrice?.price ?? null,
      currency: latestPrice?.currency ?? null,
      source: latestPrice?.source ?? "Yahoo Finance",
      error: latestPrice ? null : "沒有可用的前一交易日收盤價。",
    };
  });
}

function addUtcDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function fetchYahooHistoricalObservations(normalizedTicker, { from, to }) {
  if (!createDateRange(from, to).length) {
    return [];
  }

  const periodStart = addUtcDays(from, -10);
  const periodEnd = addUtcDays(to, 1);
  const period1 = Math.floor(new Date(`${periodStart}T00:00:00Z`).getTime() / 1000);
  const period2 = Math.floor(new Date(`${periodEnd}T00:00:00Z`).getTime() / 1000);
  const symbol = toYahooChartSymbol(normalizedTicker);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=1d`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    next: {
      revalidate: 3600,
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance 回應 ${response.status}`);
  }

  const payload = await response.json();
  return parseYahooHistoricalPrices(payload, normalizedTicker);
}

export async function fetchYahooHistoricalQuotes(normalizedTicker, { from, to }) {
  const dates = createDateRange(from, to);
  if (!dates.length) {
    return [];
  }

  const prices = await fetchYahooHistoricalObservations(normalizedTicker, { from, to });
  return alignHistoricalPricesToDates(prices, dates);
}

async function fetchTwseMonthlyHistoricalObservations(normalizedTicker, dateText) {
  const match = String(normalizedTicker || "").toUpperCase().match(TAIWAN_LISTED_TICKER_PATTERN);
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) {
    return [];
  }

  const month = dateText.slice(0, 7).replace("-", "");
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${month}01&stockNo=${encodeURIComponent(match[1])}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
    },
    next: {
      revalidate: 900,
    },
  });

  if (!response.ok) {
    throw new Error(`TWSE 回應 ${response.status}`);
  }

  return parseTwseHistoricalPrices(await response.json());
}

export async function fetchHistoricalQuotes(normalizedTicker, { from, to }) {
  const dates = createDateRange(from, to);
  if (!dates.length) {
    return [];
  }

  const yahooPrices = await fetchYahooHistoricalObservations(normalizedTicker, { from, to });
  let officialPrices = [];
  try {
    officialPrices = await fetchTwseMonthlyHistoricalObservations(normalizedTicker, to);
  } catch {
    // Yahoo remains available when the official recent-month supplement is unavailable.
  }

  return alignHistoricalPricesToDates(
    mergeHistoricalPriceObservations(yahooPrices, officialPrices),
    dates,
  );
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

function parseTwseFirstLevelPrice(value) {
  return parseTwseNumber(String(value || "").split("_")[0]);
}

export function parseTwseQuote(stockInfo, source = "TWSE") {
  const tradePrice = parseTwseNumber(stockInfo?.z);
  const quotedDate = formatTwseDate(stockInfo?.d);

  if (tradePrice && quotedDate) {
    return {
      price: tradePrice,
      date: quotedDate,
      currency: "TWD",
      source,
      error: null,
    };
  }

  const bestAsk = parseTwseFirstLevelPrice(stockInfo?.a);
  const bestBid = parseTwseFirstLevelPrice(stockInfo?.b);
  if (bestAsk && bestBid && quotedDate) {
    return {
      price: (bestAsk + bestBid) / 2,
      date: quotedDate,
      currency: "TWD",
      source,
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
      source,
      error: null,
    };
  }

  throw new Error("TWSE 沒有回傳可用價格。");
}

export function toTwseChannel(normalizedTicker) {
  const match = String(normalizedTicker || "").toUpperCase().match(TAIWAN_LISTED_TICKER_PATTERN);
  return match ? `tse_${match[1]}.tw` : null;
}

export function toTpexChannel(normalizedTicker) {
  const match = String(normalizedTicker || "").toUpperCase().match(TAIWAN_EXCHANGE_TICKER_PATTERN);
  return match ? `otc_${match[1]}.tw` : null;
}

async function fetchTaiwanChannel(channel, source) {
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
    throw new Error(`${source} 回應 ${response.status}`);
  }

  const payload = await response.json();
  return parseTwseQuote(payload?.msgArray?.[0], source);
}

export async function fetchTwseQuote(normalizedTicker) {
  const listedChannel = toTwseChannel(normalizedTicker);
  const otcChannel = toTpexChannel(normalizedTicker);
  const channels = listedChannel
    ? [[listedChannel, "TWSE"], [otcChannel, "TPEx"]]
    : otcChannel
      ? [[otcChannel, "TPEx"]]
      : [];
  if (!channels.length) {
    throw new Error("不是 TWSE 上市股票代號。");
  }

  let lastError = null;
  for (const [channel, source] of channels) {
    try {
      return await fetchTaiwanChannel(channel, source);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("台灣市場沒有回傳可用價格。");
}

export async function fetchYahooQuote(normalizedTicker) {
  if (toTwseChannel(normalizedTicker) || toTpexChannel(normalizedTicker)) {
    try {
      return await fetchTwseQuote(normalizedTicker);
    } catch {
      // Fall through to Yahoo Finance when TWSE is temporarily unavailable.
    }
  }

  const yahooTickers = normalizedTicker.endsWith(".TW")
    ? [normalizedTicker, normalizedTicker.replace(/\.TW$/, ".TWO")]
    : [normalizedTicker];
  let lastYahooError = null;

  for (const yahooTicker of yahooTickers) {
    const symbol = toYahooChartSymbol(yahooTicker);
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
      lastYahooError = new Error(`Yahoo Finance 回應 ${response.status}`);
      continue;
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
          currency: meta.currency || guessCurrency(yahooTicker),
          source: "Yahoo Finance",
          error: null,
        };
      }
    }
    lastYahooError = new Error("Yahoo Finance 沒有回傳可用價格。");
  }

  throw lastYahooError || new Error("Yahoo Finance 沒有回傳可用價格。");
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
