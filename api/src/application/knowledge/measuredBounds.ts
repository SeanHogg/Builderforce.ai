/**
 * measuredBounds — the ONE bound on what a scope may state it was measured with (memory's `MeasuredWith`, PRD 41 §C9)
 * before the platform stores it (`knowledge_scopes.extractor_version` varchar(64), `tool_versions` jsonb). Both writers
 * hold a scope to it: the sync pack (`packValidation.ts`, a `422 bad_pack`) and the row writer's body (`zScope`, a 400).
 */
import type { MeasuredWith } from '@seanhogg/builderforce-memory/knowledge';
import { isCleanKey } from '@builderforce/agent-tools';

/** At most this many analyzers. */
export const MAX_MEASURED_TOOLS = 32;
/** The extractor version, an analyzer name and a version: 1..64 characters, printable. */
export const MAX_MEASURED_TEXT = 64;

const text = (s: unknown): boolean => typeof s === 'string' && s.length > 0 && s.length <= MAX_MEASURED_TEXT && isCleanKey(s);

/** Why `m` cannot be stored, or `undefined` when it can. */
export function measuredProblem(m: MeasuredWith): string | undefined {
  if (!text(m.extractorVersion)) return `measured.extractorVersion is 1..${MAX_MEASURED_TEXT} printable characters`;
  if (!m.toolVersions || typeof m.toolVersions !== 'object' || Array.isArray(m.toolVersions)) return 'measured.toolVersions is an object of tool → version';
  const tools = Object.entries(m.toolVersions);
  if (tools.length > MAX_MEASURED_TOOLS) return `measured names at most ${MAX_MEASURED_TOOLS} tools`;
  for (const [tool, version] of tools) {
    if (!text(tool) || !text(version)) return `measured.toolVersions: a tool and its version are 1..${MAX_MEASURED_TEXT} printable characters`;
  }
  return undefined;
}
