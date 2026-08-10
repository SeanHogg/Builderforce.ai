/**
 * verifyWrittenFiles — real, in-Worker static validation of an agent's committed
 * changes, so the shell-less durable executor's `run_checks` is an ACTUAL check
 * instead of a no-op confession.
 *
 * Scope is honest and dependency-light:
 *   - JSON/YAML syntax is parsed exactly;
 *   - changed TS/JS is evaluated by source-only, low-false-positive quality rules.
 * Full build / type-check / lint / tests remain CI-on-PR work (and run directly on
 * the long-lived Container surface). Never throws.
 */
import { parse as parseYaml } from 'yaml';
import { readRepoFile, type RepoReadContext } from './readRepoContents';
import { inspectAgentSource } from './sourceQualityPolicy';

export interface VerifyResult {
  /** False when any statically-checkable file failed to parse. */
  ok: boolean;
  /** Files that passed an applicable syntax/source policy. */
  checked: string[];
  /** Files with no applicable policy, or which were unreadable/truncated. */
  skipped: string[];
  /** Parse failures the agent must fix. */
  errors: Array<{ path: string; message: string; line?: number; ruleId?: string }>;
}

const JSON_EXT = /\.json$/i;
const YAML_EXT = /\.ya?ml$/i;
const SOURCE_EXT = /\.[cm]?[jt]sx?$/i;

export async function verifyWrittenFiles(
  ctx: RepoReadContext,
  paths: Iterable<string>,
): Promise<VerifyResult> {
  const list = [...paths];
  const outcomes = await Promise.all(list.map(async (path): Promise<
    { kind: 'checked' | 'skipped'; path: string }
    | { kind: 'errors'; path: string; errors: Array<{ message: string; line?: number; ruleId?: string }> }
  > => {
    const isJson = JSON_EXT.test(path);
    const isYaml = YAML_EXT.test(path);
    const isSource = SOURCE_EXT.test(path);
    if (!isJson && !isYaml && !isSource) return { kind: 'skipped', path };
    const rf = await readRepoFile(ctx, path);
    // Can't read (transient) or content was truncated for size → don't false-fail.
    if (!rf.ok || rf.truncated) return { kind: 'skipped', path };
    try {
      if (isJson) JSON.parse(rf.content);
      else if (isYaml) parseYaml(rf.content);
      else {
        const findings = inspectAgentSource(path, rf.content);
        if (findings.length) {
          return {
            kind: 'errors', path,
            errors: findings.map((f) => ({ message: f.message, line: f.line, ruleId: f.ruleId })),
          };
        }
      }
      return { kind: 'checked', path };
    } catch (e) {
      return { kind: 'errors', path, errors: [{ message: (e as Error).message.slice(0, 240) }] };
    }
  }));

  const checked: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ path: string; message: string; line?: number; ruleId?: string }> = [];
  for (const o of outcomes) {
    if (o.kind === 'errors') errors.push(...o.errors.map((error) => ({ path: o.path, ...error })));
    else if (o.kind === 'checked') checked.push(o.path);
    else skipped.push(o.path);
  }
  return { ok: errors.length === 0, checked, skipped, errors };
}
