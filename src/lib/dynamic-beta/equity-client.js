import { fetchYahooHistoricalObservations } from "../market-data.js";
import { normalizeMarketObservation } from "./normalize.js";

export async function fetchEquityObservations(
  series,
  {
    from,
    to,
    retrievedAt,
    fetchHistorical = fetchYahooHistoricalObservations,
  },
) {
  const prices = await fetchHistorical(series.symbol, { from, to });
  return prices
    .filter((price) => price.date >= from && price.date <= to)
    .map((price) =>
      normalizeMarketObservation(series.seriesId, price, retrievedAt),
    )
    .filter(Boolean);
}
