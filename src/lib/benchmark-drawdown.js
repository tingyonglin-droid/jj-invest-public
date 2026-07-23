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

export function createBenchmarkDrawdown(prices) {
  const validPrices = (Array.isArray(prices) ? prices : [])
    .filter((item) => item?.date && Number.isFinite(Number(item.price)) && Number(item.price) > 0)
    .map((item) => ({
      date: item.date,
      price: Number(item.price),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!validPrices.length) {
    return null;
  }

  const current = validPrices.at(-1);
  const high = validPrices.reduce(
    (best, item) => (item.price > best.price ? item : best),
    validPrices[0],
  );

  const drawdownRatio = roundNumber(current.price / high.price - 1);

  return {
    currentDate: current.date,
    currentPrice: roundNumber(current.price),
    highDate: high.date,
    highPrice: roundNumber(high.price),
    drawdownRatio,
    level: getBenchmarkDrawdownLevel(drawdownRatio),
  };
}
