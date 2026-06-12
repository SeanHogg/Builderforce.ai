/**
 * verifyWrittenFiles — real, in-Worker static validation of an agent's committed
 * changes, so the shell-less durable executor's `run_checks` is an ACTUAL check
 * instead of a no-op confession.
 *
 * Scope is honest and zero-false-positive: it parses the file formats a Worker can
 * validate with certainty and no heavy deps — JSON (`JSON.parse`) and YAML (the
 * runtime `yaml` dep). These are exactly the config edits a coding agent commonly
 * breaks (a trailing comma in a `.json`, bad indentation in a CI `.yml`) and that
 * would otherwise only surface as a red PR. It deliberately does NOT attempt to
 * parse TS/JS: a single-file Worker check can't type-check (needs the whole program
 * + node_modules types) and a hand-rolled JS tokenizer would risk false positives
 * that wrongly block the agent. Build / project-wide type-check / lint / tests stay
 * the job of CI-on-PR (and the long-lived Container surface). Never throws.
 */
import { parse as parseYaml } from 'yaml';
import { readRepoFile, type RepoReadContext } from './readRepoContents';

export interface VerifyResult {
  /** False when any statically-checkable file failed to parse. */
  ok: boolean;
  /** Files that parsed cleanly (JSON/YAML). */
  checked: string[];
  /** Files not statically verifiable in-Worker (non-config, unreadable, or truncated). */
  skipped: string[];
  /** Parse failures the agent must fix. */
  errors: Array<{ path: string; message: string }>;
}

const JSON_EXT = /\.json$/i;
const YAML_EXT = /\.ya?ml$/i;

export async function verifyWrittenFiles(
  ctx: RepoReadContext,
  paths: Iterable<string>,
): Promise<VerifyResult> {
  const list = [...paths];
  const outcomes = await Promise.all(list.map(async (path): Promise<
    { kind: 'checked' | 'skipped'; path: string } | { kind: 'error'; path: string; message: string }
  > => {
    const isJson = JSON_EXT.test(path);
    const isYaml = YAML_EXT.test(path);
    if (!isJson && !isYaml) return { kind: 'skipped', path };
    const rf = await readRepoFile(ctx, path);
    // Can't read (transient) or content was truncated for size → don't false-fail.
    if (!rf.ok || rf.truncated) return { kind: 'skipped', path };
    try {
      if (isJson) JSON.parse(rf.content);
      else parseYaml(rf.content);
      return { kind: 'checked', path };
    } catch (e) {
      return { kind: 'error', path, message: (e as Error).message.slice(0, 240) };
    }
  }));

  const checked: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  for (const o of outcomes) {
    if (o.kind === 'error') errors.push({ path: o.path, message: o.message });
    else if (o.kind === 'checked') checked.push(o.path);
    else skipped.push(o.path);
  }
  return { ok: errors.length === 0, checked, skipped, errors };
}
