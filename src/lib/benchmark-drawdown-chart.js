const MIN_WIDTH = 760;
const VIEWBOX_HEIGHT = 430;
const POINT_GAP = 44;
const RIGHT_PADDING = 42;
const PLOT = Object.freeze({ left: 92, right: 718, top: 40, bottom: 340 });

const MARKET_LEVEL_LABELS = Object.freeze({
  normal: "正常區間",
  prepare: "觀察區間",
  deep: "風險區間",
});

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function drawdownY(ratio) {
  const clampedRatio = Math.max(-0.3, Math.min(0, Number(ratio) || 0));
  return round(PLOT.top + (Math.abs(clampedRatio) / 0.3) * (PLOT.bottom - PLOT.top));
}

export function createBenchmarkDrawdownChart(history, highPrice) {
  const records = Array.isArray(history) ? history : [];
  const width = Math.max(
    MIN_WIDTH,
    PLOT.left + RIGHT_PADDING + Math.max(0, records.length - 1) * POINT_GAP,
  );
  const plot = { ...PLOT, right: width - RIGHT_PADDING };
  const step = records.length > 1 ? (plot.right - plot.left) / (records.length - 1) : 0;
  const labelEvery = Math.max(1, Math.ceil(records.length / 12));
  const points = records.map((record, index) => {
    const x = round(
      records.length === 1 ? (plot.left + plot.right) / 2 : plot.left + step * index,
    );
    const isFirst = index === 0;
    const isLast = index === records.length - 1;
    return {
      ...record,
      x,
      y: drawdownY(record.drawdownRatio),
      tooltipX: round(x + (isFirst ? 12 : isLast ? -12 : 0)),
      tooltipAnchor: isFirst ? "start" : isLast ? "end" : "middle",
      showDateLabel: isFirst || isLast || index % labelEvery === 0,
    };
  });

  return {
    width,
    height: VIEWBOX_HEIGHT,
    viewBox: `0 0 ${width} ${VIEWBOX_HEIGHT}`,
    plot,
    points,
    linePoints: points.map((point) => `${point.x},${point.y}`).join(" "),
    thresholds: [0, -0.1, -0.2].map((ratio) => ({
      ratio,
      y: drawdownY(ratio),
      price: round(Number(highPrice) * (1 + ratio)),
    })),
  };
}

export function toggleActiveMarketPoint(currentIndex, clickedIndex) {
  return currentIndex === clickedIndex ? null : clickedIndex;
}

export function getMarketLevelLabel(level) {
  return MARKET_LEVEL_LABELS[level] || "市場水位";
}
