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

function normalizeFourForOneDiscontinuities(prices) {
  const normalized = prices.map((item) => ({ ...item }));

  for (let index = 1; index < normalized.length; index += 1) {
    const previousPrice = normalized[index - 1].price;
    const currentPrice = normalized[index].price;
    const splitFactor = Math.round(previousPrice / currentPrice);
    const ratio = currentPrice / previousPrice;

    if (splitFactor === 4 && ratio >= 0.2 && ratio <= 0.3) {
      for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
        normalized[priorIndex].price = roundNumber(normalized[priorIndex].price / splitFactor);
      }
    }
  }

  return normalized;
}

export function createBenchmarkDrawdown(prices, options = {}) {
  const priceByDate = new Map();
  (Array.isArray(prices) ? prices : []).forEach((item) => {
    const normalized = normalizePriceRecord(item);
    if (normalized) {
      priceByDate.set(normalized.date, normalized);
    }
  });
  const validPrices = normalizeFourForOneDiscontinuities(
    [...priceByDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  );

  if (!validPrices.length) {
    return null;
  }

  priceByDate.clear();
  validPrices.forEach((item) => priceByDate.set(item.date, item));

  const liveCurrent = normalizePriceRecord(options.currentQuote);
  const current = liveCurrent || validPrices.at(-1);
  const high = validPrices.reduce(
    (best, item) => (item.price >= best.price ? item : best),
    validPrices[0],
  );

  const closingHighByDate = new Map();
  let rollingClosingHigh = validPrices[0].price;
  validPrices.forEach((item) => {
    rollingClosingHigh = Math.max(rollingClosingHigh, item.price);
    closingHighByDate.set(item.date, rollingClosingHigh);
  });

  if (liveCurrent) {
    priceByDate.set(liveCurrent.date, liveCurrent);
  }

  const fullHistory = [...priceByDate.values()]
    .filter((item) => item.date <= current.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((item) => {
      const itemHighPrice = closingHighByDate.get(item.date) || high.price;
      const itemDrawdownRatio = roundNumber(item.price / itemHighPrice - 1);
      return {
        ...item,
        drawdownRatio: itemDrawdownRatio,
        level: getBenchmarkDrawdownLevel(itemDrawdownRatio),
      };
    });
  const history = fullHistory.filter((item) => item.date >= high.date);

  const drawdownRatio = roundNumber(current.price / high.price - 1);

  return {
    currentDate: current.date,
    currentPrice: roundNumber(current.price),
    highDate: high.date,
    highPrice: roundNumber(high.price),
    drawdownRatio,
    level: getBenchmarkDrawdownLevel(drawdownRatio),
    currentSource: liveCurrent ? "live" : "close",
    fullHistory,
    history,
  };
}
