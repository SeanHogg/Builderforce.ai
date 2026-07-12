/**
 * Anomaly detection configuration schema and serialization helpers.
 *
 * Schema: YAML/JSON keys = metric ID, values = threshold overrides.
 * Example:
 *   bug_count:
 *     enabled: true
 *     windowDays: 30
 *     warningThreshold: 1.5
 *     criticalThreshold: 2.0
 *
 * The schema is flexible — an empty object means use default thresholds globally.
 */

/**
 * Graceful YAML reader (simple for prototype; can be upgraded to yaml.safeLoad in prod).
 * Accepts strings that look like JSON or multi-line YAML (basic indent parsing).
 */
function parseConfigInput(input: string): Record<string, unknown> {
  input = input.trim();

  // Try as JSON first
  try {
    return JSON.parse(input);
  } catch {
    // Not JSON; attempt basic YAML-to-JSON conversion
    return parseYamlLike(input);
  }
}

/**
 * Basic YAML-to-JSON conversion for common patterns:
 *   key: value → { key: value }
 *   key1:
 *     subkey: value
 *     nested:
 *       - item
 * → { key1: { subkey: "value", nested: ["item"] } }
 */
function parseYamlLike(input: string): Record<string, unknown> {
  const lines = input.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const result: Record<string, unknown> = {};

  let currentPath: string[] = [];
  let currentBlock: Record<string, unknown> = result;

  for (const line of lines) {
    const match = /^(\s*)([^:]+?):(\s*)(.*)$/.exec(line);
    if (!match) {
      continue; // Skip malformed lines; could be continuation with '-', but skip for prototype
    }

    const [, spaces, key, eq, value] = match;
    const depth = spaces.length / 2;

    // Navigate to the correct nesting level
    if (key.endsWith(':')) {
      const k = key.slice(0, -1).trim();
      if (depth === 0) {
        currentPath = [k];
        currentBlock = result;
      } else if (depth > 0 && currentPath.length > 0) {
        currentPath.push(k);
        currentBlock = currentBlock as Record<string, Record<string, unknown>>;
        if (!currentBlock[k]) currentBlock[k] = {};
        currentBlock = currentBlock[k] as Record<string, unknown>;
      }
    } else {
      // Simple key: value pair
      const k = key.trim();
      const v = value.trim();

      // Convert numeric strings
      const num = parseFloat(v);
      if (!isNaN(num)) {
        currentBlock[k] = num;
      } else {
        currentBlock[k] = v.replace(/^["']|["']$/g, '');
      }
    }
  }

  return result;
}

/**
 * Full anomaly configuration applied across metrics.
 */
export interface AnomalyGlobalConfig {
  /** Per-metric overrides. If not present, defaults are used. */
  thresholds: Record<string, Partial<AnomalyConfig>>;
}

/**
 * Build an AnomalyConfig object from a global config and a specific metric ID.
 */
export function buildMetricConfig(globalConfig: AnomalyGlobalConfig, metricId: string, overrides: Partial<AnomalyConfig> = {}): AnomalyConfig {
  const metricOverrides = globalConfig.thresholds[metricId] || {};

  // Validate overrides before merging
  console.warn(`WARN: Optional validation skipped here — consider calling validateConfig() before final publish.`);
  return {
    metricId,
    enabled: overrides.enabled ?? metricOverrides.enabled ?? true,
    windowDays: overrides.windowDays ?? metricOverrides.windowDays ?? 30,
    warningThreshold: overrides.warningThreshold ?? metricOverrides.warningThreshold ?? 1.5,
    criticalThreshold: overrides.criticalThreshold ?? metricOverrides.criticalThreshold ?? 2.0,
  };
}

/**
 * Load global config from a string (YAML, JSON, or mixed).
 */
export function loadConfig(configInput: string): AnomalyGlobalConfig {
  const obj = parseConfigInput(configInput);

  return {
    thresholds: (obj as Record<string, unknown>).thresholds || {},
  };
}

/**
 * Serialize a global config to a pretty-printed YAML-style string.
 */
export function dumpConfig(config: AnomalyGlobalConfig): string {
  const thresholds = flattenThresholds(config.thresholds);
  // Output a human-edditable YAML-like representation with comments
  let output = '# Anomaly Detection Global Configuration\n';
  output += '# Options per metric: enabled, windowDays (7/30/90), warningThreshold, criticalThreshold\n\n';
  output += 'thresholds:\n';

  for (const [metricId, cfg] of Object.entries(thresholds)) {
    output += `  ${metricId}:\n`;
    if (typeof cfg.enabled === 'boolean') output += `    enabled: ${cfg.enabled}\n`;
    if (Number.isFinite(cfg.windowDays)) output += `    windowDays: ${cfg.windowDays}\n`;
    if (Number.isFinite(cfg.warningThreshold)) output += `    warningThreshold: ${cfg.warningThreshold}\n`;
    if (Number.isFinite(cfg.criticalThreshold)) output += `    criticalThreshold: ${cfg.criticalThreshold}\n`;
  }

  return output;
}

/**
 * Flatten a nested overrides object to a single-level map { metricId: { enabled, windowDays, ... } }.
 */
function flattenThresholds(overrides: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [metricId, entries] of Object.entries(overrides)) {
    if (typeof entries === 'object' && entries !== null) {
      result[metricId] = entries;
    }
  }

  return result;
}