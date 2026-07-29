function normalizedTitle(value) {
  return String(value || "")
    .toLocaleLowerCase("en-US")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value) {
  const normalized = normalizedTitle(value);
  if (!normalized) return new Set();
  if (/\p{Script=Han}/u.test(normalized)) {
    const characters = [...normalized.replace(/\s/g, "")];
    if (characters.length < 2) return new Set(characters);
    return new Set(characters.slice(0, -1).map((character, index) => (
      `${character}${characters[index + 1]}`
    )));
  }
  const words = normalized.split(" ").filter(Boolean);
  if (words.length > 1) return new Set(words);
  const characters = [...normalized.replace(/\s/g, "")];
  if (characters.length < 2) return new Set(characters);
  return new Set(characters.slice(0, -1).map((character, index) => (
    `${character}${characters[index + 1]}`
  )));
}

export function compareNewsTitles(left, right) {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) {
    return { similarity: 0, likelyDuplicate: false };
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const similarity = intersection / union;
  return { similarity, likelyDuplicate: similarity >= 0.7 };
}
