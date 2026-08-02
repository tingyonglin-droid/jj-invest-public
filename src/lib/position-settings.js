function isOriginalPosition(position) {
  return Number(position?.assetBeta) === 1;
}

export function getPositionGroups(positions) {
  return {
    leveraged: positions.filter((position) => !isOriginalPosition(position)),
    original: positions.filter(isOriginalPosition),
  };
}
