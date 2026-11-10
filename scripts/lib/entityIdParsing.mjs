/**
 * What `check:entity-id-parsing` looks for, and where (docs/design/typed-entity-ids.md §2, §8). Pure, so
 * `entityIdParsing.test.mjs` can pin it and `check-entity-id-parsing.mjs` (the guard) only enumerates files and reports.
 *
 * The rule: every UUID check and every "is this text a server integer id" parse goes through
 * `packages/local-first/src/entityId.ts` (`isLocalId`, `parseSyncId`, `parseEntityRef`, `isIntegerIdText`). A second regex
 * is a second definition of what an id is, and the copies drift (the sync path had five).
 */

/** The one file allowed to spell the patterns. */
export const OWNER = 'packages/local-first/src/entityId.ts';

/**
 * Where both patterns are held: the trees that read entity ids off the wire, the device store or a tool result.
 * `api/src` outside sync is held for the UUID pattern only, through the allowlist (§7: its sweep is a logged DRY entry).
 */
export const SCOPED = [
  'packages/local-first/src/',
  'api/src/application/sync/',
  'clients/vscode/src/',
  'clients/chrome/src/',
  'brain-embedded/src/',
];
export const UUID_ONLY = ['api/src/'];

const EXTS = /\.(?:[cm]?[jt]sx?)$/;

/** Tests and fixtures spell ids on purpose. */
export function isExempt(rel) {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.includes('/__fixtures__/') || rel.endsWith('.d.ts');
}

/** The patterns `rel` is held to: `['uuid', 'integer']`, `['uuid']`, or none. */
export function kindsFor(rel) {
  if (!EXTS.test(rel) || rel === OWNER || isExempt(rel)) return [];
  if (SCOPED.some((prefix) => rel.startsWith(prefix))) return ['uuid', 'integer'];
  if (UUID_ONLY.some((prefix) => rel.startsWith(prefix))) return ['uuid'];
  return [];
}

/**
 * A UUID regex: a hex character class repeated 8 times and followed by a hyphen (`[0-9a-f]{8}-`, `[0-9a-fA-F]{8}\-`,
 * `[\da-f]{8}-`), or a hex-and-hyphen class repeated 36 times (`[0-9a-f-]{36}`).
 */
const UUID = /\[[^\]\n]*(?:a-f|A-F)[^\]\n]*\]\{8\}\\?-|\[[^\]\n]*(?:a-f|A-F)[^\]\n]*\]\{36\}/;

/**
 * A whole-string integer parse: `^\d+$`, `^[0-9]+$`, `^-?\d+$`, `^[1-9]\d*$`, `^\s*\d+\s*$`, also with the doubled
 * backslash of a `new RegExp('...')` string.
 */
const DIGIT = String.raw`(?:\\{1,2}d|\[0-9\])`;
const WS = String.raw`(?:\\{1,2}s\*)?`;
const INTEGER = new RegExp(String.raw`\^${WS}(?:-\??)?(?:${DIGIT}[+*]|\[1-9\]${DIGIT}\*)${WS}\$`);

/** Comment lines describe the patterns (often naming `entityId.ts`'s own); only code is held. */
function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/** Every finding in `text`: `{ file, kind, line, text }`, for the kinds `rel` is held to. */
export function findViolations(rel, text) {
  const kinds = kindsFor(rel);
  if (kinds.length === 0) return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (kinds.includes('uuid') && UUID.test(line)) out.push({ file: rel, kind: 'uuid', line: i + 1, text: line.trim() });
    if (kinds.includes('integer') && INTEGER.test(line)) out.push({ file: rel, kind: 'integer', line: i + 1, text: line.trim() });
  }
  return out;
}

/**
 * Split findings into the ones an allowlist entry covers and the rest. An entry `{ file, kind, reason }` covers every
 * finding of `kind` in `file`. Entries that cover nothing are returned as `stale`, so the list cannot outlive its sites.
 */
export function applyAllowlist(findings, allowlist) {
  const used = new Set();
  const violations = [];
  for (const f of findings) {
    const idx = allowlist.findIndex((e) => e.file === f.file && e.kind === f.kind);
    if (idx === -1) violations.push(f);
    else used.add(idx);
  }
  const stale = allowlist.filter((_, idx) => !used.has(idx));
  return { violations, stale };
}
