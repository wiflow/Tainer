export type ScoreSample = {
  at: number;
  score: number;
};

export type ScoreForecast = {
  predictedScore: number;
  slopePerMinute: number;
  r2: number;
  sampleCount: number;
};

export const FORECAST_MIN_SAMPLES = 30;

export const FORECAST_WINDOW_MS = 30 * 60_000;

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

  if (ssXX === 0 || ssYY === 0) return null;

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
