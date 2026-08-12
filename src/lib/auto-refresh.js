export const AUTO_REFRESH_INTERVAL_MS = 60_000;
export const QUOTE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

function hasUsableQuote(quote) {
  return !quote?.error && Number.isFinite(quote?.priceTwd) && quote.priceTwd > 0;
}

function hasUsableFx(fx) {
  return !fx?.error && Number.isFinite(fx?.usdTwd) && fx.usdTwd > 0;
}

export function mergeQuoteResults(previous, incoming) {
  const incomingQuotes = Array.isArray(incoming?.quotes) ? incoming.quotes : [];
  const previousQuoteByTicker = new Map(
    (Array.isArray(previous?.quotes) ? previous.quotes : [])
      .filter(hasUsableQuote)
      .map((quote) => [quote.normalizedTicker, quote]),
  );
  let usedStaleData = false;
  const quotes = incomingQuotes.map((quote) => {
    if (hasUsableQuote(quote)) {
      return quote;
    }

    const previousQuote = previousQuoteByTicker.get(quote?.normalizedTicker);
    if (previousQuote) {
      usedStaleData = true;
      return previousQuote;
    }
    return quote;
  });
  const incomingFx = incoming?.fx || {};
  const fxFailed = !hasUsableFx(incomingFx);
  const fx = fxFailed && hasUsableFx(previous?.fx) ? previous.fx : incomingFx;
  if (fx !== incomingFx) {
    usedStaleData = true;
  }
  const hasFailures = incomingQuotes.some((quote) => !hasUsableQuote(quote)) || fxFailed;

  return {
    result: { quotes, fx },
    hasFailures,
    usedStaleData,
  };
}

export function shouldAutoRefreshQuotes({ tickers, visibilityState, status }) {
  return tickers.length > 0 && visibilityState === "visible" && status !== "loading";
}
