import { danger, info, logVerboseConsole, success, warn } from "./globals.js";
import type { ConsoleLoggerSettings, ConsoleStyle } from "./logging/console.js";
import {
  enableConsoleCapture,
  getConsoleSettings,
  getResolvedConsoleSettings,
  routeLogsToStderr,
  setConsoleSubsystemFilter,
  setConsoleConfigLoaderForTests,
  setConsoleTimestampPrefix,
  shouldLogSubsystemToConsole,
} from "./logging/console.js";
import type { LoggerResolvedSettings, LoggerSettings, PinoLikeLogger } from "./logging/file.js";
import {
  appendGatewayLifecycleAudit,
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_FILE,
  getChildLogger,
  getLogger,
  getResolvedLoggerSettings,
  isFileLogLevelEnabled,
  onLoggerReset,
  resetLogger,
  setLoggerOverride,
  toPinoLikeLogger,
} from "./logging/file.js";
import type { LogLevel } from "./logging/levels.js";
import { ALLOWED_LOG_LEVELS, levelToMinLevel, normalizeLogLevel } from "./logging/levels.js";
import type { SubsystemLogger } from "./logging/subsystem.js";
import {
  createSubsystemLogger,
  createSubsystemRuntime,
  runtimeForLogger,
  stripRedundantSubsystemPrefixForConsole,
} from "./logging/subsystem.js";
import { defaultRuntime, type RuntimeEnv } from "./runtime.js";

// ── Subsystem extraction ──────────────────────────────────────────────────────
//
// Messages may carry a subsystem hint in one of two conventional forms:
//   1. "subsystem: rest of message"   (colon-space separated)
//   2. "[subsystem] rest of message"  (bracket-wrapped)
//
// When the default runtime is in use we route through createSubsystemLogger so
// the log line hits **both** the console formatter (gateway terminal) **and**
// the JSON file logger — a unified pub/sub pipeline.

const subsystemColonRe = /^([a-z][a-z0-9-]{1,30}):\s+(.*)$/i;
const subsystemBracketRe = /^\[([a-z][a-z0-9_.:/-]{0,40})\]\s*(.*)$/i;

type ParsedSubsystem = { subsystem: string; rest: string };

function parseSubsystem(message: string): ParsedSubsystem | null {
  const colonMatch = message.match(subsystemColonRe);
  if (colonMatch) {
    return { subsystem: colonMatch[1], rest: colonMatch[2] };
  }
  const bracketMatch = message.match(subsystemBracketRe);
  if (bracketMatch) {
    return { subsystem: bracketMatch[1], rest: bracketMatch[2] };
  }
  return null;
}

// ── Logger cache ──────────────────────────────────────────────────────────────

const loggerCache = new Map<string, SubsystemLogger>();

function getSubsystem(name: string): SubsystemLogger {
  let logger = loggerCache.get(name);
  if (!logger) {
    logger = createSubsystemLogger(name);
    loggerCache.set(name, logger);
  }
  return logger;
}

export function resetLoggerCache(): void {
  loggerCache.clear();
}

// Auto-clear subsystem cache whenever the underlying file logger is reset.
onLoggerReset(resetLoggerCache);

// ── Public log helpers ────────────────────────────────────────────────────────

export function logInfo(message: string, runtime: RuntimeEnv = defaultRuntime) {
  if (runtime !== defaultRuntime) {
    runtime.log(info(message));
    getLogger().info(message);
    return;
  }
  const parsed = parseSubsystem(message);
  if (parsed) {
    getSubsystem(parsed.subsystem).info(parsed.rest);
  } else {
    getSubsystem("general").info(message);
  }
}

export function logWarn(message: string, runtime: RuntimeEnv = defaultRuntime) {
  if (runtime !== defaultRuntime) {
    runtime.log(warn(message));
    getLogger().warn(message);
    return;
  }
  const parsed = parseSubsystem(message);
  if (parsed) {
    getSubsystem(parsed.subsystem).warn(parsed.rest);
  } else {
    getSubsystem("general").warn(message);
  }
}

export function logSuccess(message: string, runtime: RuntimeEnv = defaultRuntime) {
  if (runtime !== defaultRuntime) {
    runtime.log(success(message));
    getLogger().info(message);
    return;
  }
  const parsed = parseSubsystem(message);
  if (parsed) {
    getSubsystem(parsed.subsystem).info(parsed.rest);
  } else {
    getSubsystem("general").info(message);
  }
}

export function logError(message: string, runtime: RuntimeEnv = defaultRuntime) {
  if (runtime !== defaultRuntime) {
    runtime.error(danger(message));
    getLogger().error(message);
    return;
  }
  const parsed = parseSubsystem(message);
  if (parsed) {
    getSubsystem(parsed.subsystem).error(parsed.rest);
  } else {
    getSubsystem("general").error(message);
  }
}

export function logDebug(message: string) {
  getLogger().debug(message);
  logVerboseConsole(message);
}

// ── Re-exports ────────────────────────────────────────────────────────────────

export {
  appendGatewayLifecycleAudit,
  enableConsoleCapture,
  getConsoleSettings,
  getResolvedConsoleSettings,
  routeLogsToStderr,
  setConsoleSubsystemFilter,
  setConsoleConfigLoaderForTests,
  setConsoleTimestampPrefix,
  shouldLogSubsystemToConsole,
  ALLOWED_LOG_LEVELS,
  levelToMinLevel,
  normalizeLogLevel,
  DEFAULT_LOG_DIR,
  DEFAULT_LOG_FILE,
  getChildLogger,
  getLogger,
  getResolvedLoggerSettings,
  isFileLogLevelEnabled,
  onLoggerReset,
  resetLogger,
  setLoggerOverride,
  toPinoLikeLogger,
  createSubsystemLogger,
  createSubsystemRuntime,
  runtimeForLogger,
  stripRedundantSubsystemPrefixForConsole,
};

export type {
  ConsoleLoggerSettings,
  ConsoleStyle,
  LogLevel,
  LoggerResolvedSettings,
  LoggerSettings,
  PinoLikeLogger,
  SubsystemLogger,
};
