export const AUTO_REFRESH_INTERVAL_MS = 60_000;

export function shouldAutoRefreshQuotes({ tickers, visibilityState, status }) {
  return tickers.length > 0 && visibilityState === "visible" && status !== "loading";
}
