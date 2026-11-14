/**
 * The per-chat config log ({@link RunCell.configLog}): a timestamped record of the model
 * and run mode in force during a chat. The settings are GLOBAL (host-level), so a change
 * is a global event attributed to whichever chat is active when it happens — the host
 * surfaces it through the request's `configChange` hook ({@link BrainRunRequest.configChange})
 * and the run appends it here. Seeded at run start from the request (`prepareBrainRun`);
 * a mid-run change also lands on the run trace as `run.config_change`.
 */
import type { RunCell, ConfigEntry } from './runCell';
import { nowIso, pushTrace } from './runCells';

/** The config values a run starts with — what {@link seedConfigLog} records. All optional:
 *  a host that does not pin a model or a mode simply seeds less. */
export interface RunConfigSnapshot {
  model?: string;
  modelStrict?: boolean;
  routingMode?: string;
  runMode?: string;
  autoApprove?: boolean;
}

/** The most recent `to` this log recorded for `kind` — what seeding compares against. */
function lastTo(c: RunCell, kind: ConfigEntry['kind']): string | undefined {
  for (let i = c.configLog.length - 1; i >= 0; i -= 1) {
    if (c.configLog[i].kind === kind) return c.configLog[i].to;
  }
  return undefined;
}

/**
 * Seed the chat's config log from the request a run starts with: one entry each for the
 * model and the run mode in force. Idempotent per config — re-seeding the same values
 * (the next run of the same chat under the same global settings) appends nothing, while
 * a genuinely different starting model IS recorded.
 */
export function seedConfigLog(c: RunCell, snap: RunConfigSnapshot): void {
  const ts = nowIso();
  if (snap.model != null && lastTo(c, 'model') !== snap.model) {
    c.configLog.push({ ts, kind: 'model', to: snap.model });
  }
  if (snap.runMode != null && lastTo(c, 'runMode') !== snap.runMode) {
    c.configLog.push({ ts, kind: 'runMode', to: snap.runMode });
  }
}

/**
 * Record a mid-run config change on the chat's log AND the run trace. The run calls this
 * when the host fires the request's `configChange` hook — the settings are global, so the
 * change is attributed to whichever chat was active when it happened.
 */
export function recordConfigChange(
  c: RunCell,
  change: { kind: 'model' | 'runMode'; from?: string; to: string },
): void {
  const ts = nowIso();
  c.configLog.push({ ts, kind: change.kind, from: change.from, to: change.to });
  pushTrace(c, {
    ts,
    category: 'message',
    label: 'run.config_change',
    args: { kind: change.kind, from: change.from },
    result: `${change.kind} → ${change.to}`,
  });
}
