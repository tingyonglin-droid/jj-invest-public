export const REBALANCE_TARGET_RESET_AFTER_MS = 30 * 60 * 1_000;

export function shouldResetTemporaryRebalanceTarget({
  inactiveSince,
  now = Date.now(),
}) {
  if (!Number.isFinite(inactiveSince) || !Number.isFinite(now)) {
    return false;
  }

  return now - inactiveSince >= REBALANCE_TARGET_RESET_AFTER_MS;
}
