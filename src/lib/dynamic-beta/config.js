export function isStrictTrue(value) {
  return typeof value === "string" && value === "true";
}

export function getDynamicBetaFlags(environment = process.env) {
  return {
    dataEnabled: isStrictTrue(environment.DYNAMIC_BETA_DATA_ENABLED),
    scoringEnabled: isStrictTrue(environment.DYNAMIC_BETA_SCORING_ENABLED),
    publicEnabled: isStrictTrue(environment.DYNAMIC_BETA_PUBLIC_ENABLED),
  };
}

export function getDynamicBetaNewsFlags(environment = process.env) {
  return {
    dataEnabled: isStrictTrue(environment.DYNAMIC_BETA_NEWS_DATA_ENABLED),
    scoringEnabled: isStrictTrue(environment.DYNAMIC_BETA_NEWS_SCORING_ENABLED),
    publicEnabled: isStrictTrue(environment.DYNAMIC_BETA_NEWS_PUBLIC_ENABLED),
  };
}
