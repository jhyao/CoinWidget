/**
 * Chart Configuration
 *
 * To modify chart behavior, update these values:
 *
 * Examples:
 * - For 24-hour chart: HISTORY_HOURS = 24
 * - For 5-minute intervals: INTERVAL_MINUTES = 5, BINANCE_INTERVAL = '5m'
 * - For 15-minute intervals: INTERVAL_MINUTES = 15, BINANCE_INTERVAL = '15m'
 * - For 1-hour intervals: INTERVAL_MINUTES = 60, BINANCE_INTERVAL = '1h'
 *
 * Valid BINANCE_INTERVAL values: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d
 */
export const CHART_CONFIG = {
  // History duration in hours (how much historical data to load and keep)
  HISTORY_HOURS: 6,

  // Data point interval in minutes (how often to create new data points)
  INTERVAL_MINUTES: 1,

  // Binance API interval string (must match INTERVAL_MINUTES)
  BINANCE_INTERVAL: '1m' as const,

  // Chart height in pixels
  CHART_HEIGHT: 200,
} as const;

// Calculated values based on configuration
export const CALCULATED_CONFIG = {
  // Total data points to keep (HISTORY_HOURS * 60 / INTERVAL_MINUTES)
  MAX_DATA_POINTS: CHART_CONFIG.HISTORY_HOURS * 60 / CHART_CONFIG.INTERVAL_MINUTES,

  // History duration in milliseconds
  HISTORY_MS: CHART_CONFIG.HISTORY_HOURS * 60 * 60 * 1000,

  // Interval duration in milliseconds
  INTERVAL_MS: CHART_CONFIG.INTERVAL_MINUTES * 60 * 1000,
} as const;