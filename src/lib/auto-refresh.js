import { normalizeTicker } from "./market-data.js";

export const AUTO_REFRESH_INTERVAL_MS = 60_000;
export const QUOTE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

export function createLatestQuoteRequestCoordinator() {
  let latestRequestId = 0;
  let activeController = null;

  return {
    begin() {
      activeController?.abort();
      activeController = new AbortController();
      const requestId = ++latestRequestId;
      return {
        signal: activeController.signal,
        isCurrent: () => requestId === latestRequestId,
      };
    },
    invalidate() {
      latestRequestId += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

export function getVisibleCalculationErrors(errors, hasReceivedQuoteResponse) {
  return hasReceivedQuoteResponse ? errors : [];
}

function hasUsableQuote(quote) {
  return !quote?.error && Number.isFinite(quote?.priceTwd) && quote.priceTwd > 0;
}

function hasUsableFx(fx) {
  return !fx?.error && Number.isFinite(fx?.usdTwd) && fx.usdTwd > 0;
}

export function hasCompletePriorQuoteResult(previous, tickers) {
  if (!hasUsableFx(previous?.fx) || !Array.isArray(tickers) || tickers.length === 0) {
    return false;
  }

  const usableTickers = new Set(
    (Array.isArray(previous?.quotes) ? previous.quotes : [])
      .filter(hasUsableQuote)
      .map((quote) => quote.normalizedTicker),
  );
  return tickers.every((ticker) => usableTickers.has(normalizeTicker(ticker)));
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

export function createQuoteRetryController({
  setTimeoutFn,
  clearTimeoutFn,
  onRetry,
  onExhausted,
}) {
  let retryIndex = 0;
  let activeTimer = null;

  function cancelTimer() {
    if (activeTimer !== null) {
      clearTimeoutFn(activeTimer);
      activeTimer = null;
    }
  }

  return {
    schedule() {
      cancelTimer();
      if (retryIndex >= QUOTE_RETRY_DELAYS_MS.length) {
        onExhausted();
        return;
      }

      const delay = QUOTE_RETRY_DELAYS_MS[retryIndex];
      activeTimer = setTimeoutFn(() => {
        activeTimer = null;
        retryIndex += 1;
        onRetry();
      }, delay);
    },
    reset() {
      cancelTimer();
      retryIndex = 0;
    },
  };
}

export function shouldAutoRefreshQuotes({ tickers, visibilityState, status }) {
  return tickers.length > 0 && visibilityState === "visible" && status !== "loading";
}
