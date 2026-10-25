
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15 * 60 * 1_000;

export function getRetryDelayMs(attemptCount) {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error("attemptCount must be a positive integer");
  }

  return Math.min(
    BASE_DELAY_MS * 2 ** (attemptCount - 1),
    MAX_DELAY_MS,
  );
}

export function getNextAttemptAt(attemptCount, now = new Date()) {
  return new Date(now.getTime() + getRetryDelayMs(attemptCount));
}
