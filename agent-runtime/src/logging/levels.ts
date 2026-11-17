export const ALLOWED_LOG_LEVELS = [
  "silent",
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
] as const;

export type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

export function normalizeLogLevel(level?: string, fallback: LogLevel = "info") {
  const candidate = (level ?? fallback).trim();
  return ALLOWED_LOG_LEVELS.includes(candidate as LogLevel) ? (candidate as LogLevel) : fallback;
}

/**
 * Severity RANK (fatal=0 … trace=5): a level is enabled when its rank is <= the
 * configured level's rank. This is NOT tslog's scale — never pass it as a tslog
 * `minLevel`; use {@link levelToTslogMinLevel} for that.
 */
export function levelToMinLevel(level: LogLevel): number {
  const map: Record<LogLevel, number> = {
    fatal: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
    trace: 5,
    silent: Number.POSITIVE_INFINITY,
  };
  return map[level];
}

/** tslog's highest built-in level id (FATAL). */
export const TSLOG_FATAL_LEVEL_ID = 6;

/**
 * tslog's own level ids (silly=0, trace=1, debug=2, info=3, warn=4, error=5,
 * fatal=6) — what its `minLevel` option expects: tslog drops a record whose id
 * is below `minLevel`. `silent` has no tslog id; Infinity drops everything
 * (tslog warns about out-of-range values, so loggers that are silent as a whole
 * are built without transports instead — see logging/file.ts).
 */
export function levelToTslogMinLevel(level: LogLevel): number {
  const map: Record<LogLevel, number> = {
    trace: 1,
    debug: 2,
    info: 3,
    warn: 4,
    error: 5,
    fatal: TSLOG_FATAL_LEVEL_ID,
    silent: Number.POSITIVE_INFINITY,
  };
  return map[level];
}
