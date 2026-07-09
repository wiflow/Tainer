/**
 * Lightweight load forecasting for predictive balancing.
 *
 * Ordinary least-squares linear regression over a node's recent composite
 * score samples, with R² as the confidence gate. Only high-confidence,
 * clearly-trending forecasts are allowed to act (the VMware Predictive DRS
 * rule) — a noisy flat line must never trigger a pre-emptive migration.
 * Deliberately simple: at a 10-second poll interval, 30–60 minutes of
 * samples is plenty for "this node will cross the threshold soon", and a
 * model an operator can't reason about would undermine the trust the
 * dry-run workflow builds.
 */

export type ScoreSample = {
  at: number;
  score: number;
};

export type ScoreForecast = {
  /** Predicted composite score at now + horizon. */
  predictedScore: number;
  /** Regression slope in score points per minute. */
  slopePerMinute: number;
  /** Coefficient of determination, 0–1. Confidence gate. */
  r2: number;
  sampleCount: number;
};

/** Minimum samples before a forecast is meaningful. */
export const FORECAST_MIN_SAMPLES = 30;

/** Only regress over this much recent history. */
export const FORECAST_WINDOW_MS = 30 * 60_000;

/** Ring-buffer cap per node (~1h of 10s samples). */
export const HISTORY_MAX_SAMPLES = 360;

export function appendScoreSample(
  history: ScoreSample[],
  sample: ScoreSample,
): ScoreSample[] {
  history.push(sample);
  if (history.length > HISTORY_MAX_SAMPLES) {
    history.splice(0, history.length - HISTORY_MAX_SAMPLES);
  }
  return history;
}

export function forecastScore(
  history: ScoreSample[],
  horizonMinutes: number,
  now: number,
): ScoreForecast | null {
  const windowStart = now - FORECAST_WINDOW_MS;
  const samples = history.filter((s) => s.at >= windowStart);
  if (samples.length < FORECAST_MIN_SAMPLES) return null;

  // Regress score on minutes-since-window-start to keep numbers small.
  const xs = samples.map((s) => (s.at - windowStart) / 60_000);
  const ys = samples.map((s) => s.score);
  const n = samples.length;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    ssXY += dx * dy;
    ssXX += dx * dx;
    ssYY += dy * dy;
  }

  if (ssXX === 0 || ssYY === 0) return null; // constant series — nothing to predict

  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r2 = (ssXY * ssXY) / (ssXX * ssYY);

  const nowX = (now - windowStart) / 60_000;
  const predictedScore = intercept + slope * (nowX + horizonMinutes);

  return {
    predictedScore: Math.round(predictedScore * 100) / 100,
    slopePerMinute: Math.round(slope * 1000) / 1000,
    r2: Math.round(r2 * 1000) / 1000,
    sampleCount: n,
  };
}
