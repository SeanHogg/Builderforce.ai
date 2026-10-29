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
 *
 * {@link checkFileContent} is the per-file policy on bytes already in hand — the
 * post-edit check (cost PRD D7) runs it on a `write_file`'s content without a read back.
 */
import { parse as parseYaml } from 'yaml';
import { readRepoFile, type RepoReadContext } from './readRepoContents';
import type { RepoFileReader } from './repoReadMemo';
import { inspectAgentSource } from './sourceQualityPolicy';

export type VerifyError = { path: string; message: string; line?: number; ruleId?: string };

export interface VerifyResult {
  /** False when any statically-checkable file failed to parse. */
  ok: boolean;
  /** Files that passed an applicable syntax/source policy. */
  checked: string[];
  /** Files with no applicable policy, or which were unreadable/truncated. */
  skipped: string[];
  /** Parse failures the agent must fix. */
  errors: VerifyError[];
}

const JSON_EXT = /\.json$/i;
const YAML_EXT = /\.ya?ml$/i;
const SOURCE_EXT = /\.[cm]?[jt]sx?$/i;

/** Whether any shell-free policy applies to this path. */
export function isVerifiablePath(path: string): boolean {
  return JSON_EXT.test(path) || YAML_EXT.test(path) || SOURCE_EXT.test(path);
}

/** One file's content against its policy: `skipped` when none applies. Never throws. */
export function checkFileContent(
  path: string,
  content: string,
): { kind: 'checked' | 'skipped' } | { kind: 'errors'; errors: Array<Omit<VerifyError, 'path'>> } {
  if (!isVerifiablePath(path)) return { kind: 'skipped' };
  try {
    if (JSON_EXT.test(path)) JSON.parse(content);
    else if (YAML_EXT.test(path)) parseYaml(content);
    else {
      const findings = inspectAgentSource(path, content);
      if (findings.length) {
        return { kind: 'errors', errors: findings.map((f) => ({ message: f.message, line: f.line, ruleId: f.ruleId })) };
      }
    }
    return { kind: 'checked' };
  } catch (e) {
    return { kind: 'errors', errors: [{ message: (e as Error).message.slice(0, 240) }] };
  }
}

/** Fold per-file outcomes into one result. */
export function foldVerifyOutcomes(
  outcomes: ReadonlyArray<{ path: string } & ReturnType<typeof checkFileContent>>,
): VerifyResult {
  const checked: string[] = [];
  const skipped: string[] = [];
  const errors: VerifyError[] = [];
  for (const o of outcomes) {
    if (o.kind === 'errors') errors.push(...o.errors.map((error) => ({ path: o.path, ...error })));
    else if (o.kind === 'checked') checked.push(o.path);
    else skipped.push(o.path);
  }
  return { ok: errors.length === 0, checked, skipped, errors };
}

export async function verifyWrittenFiles(
  ctx: RepoReadContext,
  paths: Iterable<string>,
  /** How a file is read; defaults to the repo at `ctx`. A caller that reads the same files for
   *  another purpose passes a shared memo (`createRepoReadMemo`) so each is fetched once. */
  read: RepoFileReader = (path) => readRepoFile(ctx, path),
): Promise<VerifyResult> {
  const list = [...paths];
  const outcomes = await Promise.all(list.map(async (path) => {
    if (!isVerifiablePath(path)) return { path, kind: 'skipped' as const };
    const rf = await read(path);
    // Can't read (transient) or content was truncated for size → don't false-fail.
    if (!rf.ok || rf.truncated) return { path, kind: 'skipped' as const };
    return { path, ...checkFileContent(path, rf.content) };
  }));
  return foldVerifyOutcomes(outcomes);
}
