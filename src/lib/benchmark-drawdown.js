function roundNumber(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

export function getBenchmarkDrawdownLevel(drawdownRatio) {
  const ratio = Number(drawdownRatio);
  if (!Number.isFinite(ratio) || ratio > -0.1) {
    return "normal";
  }
  if (ratio > -0.2) {
    return "prepare";
  }
  return "deep";
}

function normalizePriceRecord(item) {
  const price = Number(item?.price);
  const date = String(item?.date || "");
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();

  if (
    !date ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isInteger(weekday) ||
    weekday === 0 ||
    weekday === 6
  ) {
    return null;
  }

  return {
    date,
    price,
  };
}

export function createBenchmarkDrawdown(prices, options = {}) {
  const priceByDate = new Map();
  (Array.isArray(prices) ? prices : []).forEach((item) => {
    const normalized = normalizePriceRecord(item);
    if (normalized) {
      priceByDate.set(normalized.date, normalized);
    }
  });
  const validPrices = [...priceByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (!validPrices.length) {
    return null;
  }

  const liveCurrent = normalizePriceRecord(options.currentQuote);
  const current = liveCurrent || validPrices.at(-1);
  const high = validPrices.reduce(
    (best, item) => (item.price >= best.price ? item : best),
    validPrices[0],
  );

  if (liveCurrent) {
    priceByDate.set(liveCurrent.date, liveCurrent);
  }

  const history = [...priceByDate.values()]
    .filter((item) => item.date >= high.date && item.date <= current.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => {
      const itemDrawdownRatio = roundNumber(item.price / high.price - 1);
      return {
        ...item,
        drawdownRatio: itemDrawdownRatio,
        level: getBenchmarkDrawdownLevel(itemDrawdownRatio),
      };
    });

  const drawdownRatio = roundNumber(current.price / high.price - 1);

  return {
    currentDate: current.date,
    currentPrice: roundNumber(current.price),
    highDate: high.date,
    highPrice: roundNumber(high.price),
    drawdownRatio,
    level: getBenchmarkDrawdownLevel(drawdownRatio),
    currentSource: liveCurrent ? "live" : "close",
    history,
  };
}
