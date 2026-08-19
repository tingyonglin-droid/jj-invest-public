export function normalizeLegacyGhostPosition(position) {
  const tickerInput = String(position?.tickerInput ?? "").trim();
  const shares = Number(position?.shares);
  const assetBeta = Number(position?.assetBeta);

  if (tickerInput === "0" && shares === 0 && assetBeta === 0) {
    return {
      ...position,
      tickerInput: "",
      assetBeta: 1,
    };
  }

  return position;
}

export function isQuoteableTickerInput(tickerInput) {
  const ticker = String(tickerInput ?? "").trim();
  return ticker !== "" && ticker !== "0";
}
