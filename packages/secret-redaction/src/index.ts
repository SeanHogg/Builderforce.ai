/**
 * @builderforce/secret-redaction — THE secret redactor.
 *
 * Consumers: the api (`infrastructure/security/redactSecrets.ts`, which adds the
 * `tool_audit_events` row helper) and agent-runtime (`logging/redact.ts`, which adds its
 * config overlay). Both share this pattern set; nothing is hand-synced.
 *
 * Entry points:
 *   - {@link redactText}    scrub a string with a pattern set.
 *   - {@link redactDeep}    scrub every string LEAF of a value (so a structure that is later
 *                           JSON-stringified stays valid JSON and a quoted secret cannot hide
 *                           behind escaping), masking whatever sits under a secret-named key.
 *   - {@link redactThenCap} redact BEFORE truncating: a cap that cuts a token in half leaves a
 *                           fragment no pattern recognises.
 *
 * Never run text-mode redaction over a JSON.stringify'd blob: escaping hides quoted secrets and
 * a mask can break the JSON. Walk the value with {@link redactDeep}, then stringify.
 */

/** One secret shape. `known` = a provider token with a recognisable prefix, safe to show prefix+suffix of. */
export interface SecretPattern {
  re: RegExp;
  known?: boolean;
}

const generic = (re: RegExp): SecretPattern => ({ re });
const known = (re: RegExp): SecretPattern => ({ re, known: true });

/** The pattern set. Order matters only in that assignments run before prefix shapes. */
export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  // ENV-style assignments: an UPPER_CASE name ending in KEY/TOKEN/SECRET/PASSWORD/PASSWD
  // (`DB_PASSWORD="a b"`, `export API_KEY=x`). Case-sensitive so `primaryKey: id` and
  // `monkey: banana` are not assignments. The value may be quoted and contain spaces.
  generic(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"']+))/g),
  // Lower-case config/CLI-style assignments, only for the WHOLE secret word (`password=hunter2`).
  generic(/\b(?:password|passwd|secret|token|api[-_]?key|access[-_]?token|client[-_]?secret|aws[-_]secret[-_]access[-_]key|secret[-_]access[-_]key)\b\s*[=:]\s*(?:"([^"\n]{4,})"|'([^'\n]{4,})'|([^\s"',;&]{4,}))/gi),
  // JSON fields.
  generic(/"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken|secretAccessKey|sessionToken)"\s*:\s*"([^"]+)"/gi),
  // CLI flags (`--token x`, `--token "x"`, `--token=x`).
  generic(/--(?:api[-_]?key|token|secret|password|passwd)(?:\s+|=)(["']?)([^\s"']+)\1/gi),
  // Authorization headers, any scheme (`Bearer x`, `Basic x`, `token x`, or a bare credential).
  generic(/Authorization\s*[:=]\s*(?:(?:Bearer|Basic|Token|Digest)\s+)?([A-Za-z0-9._\-+=/~]+)/gi),
  generic(/\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b/gi),
  // PEM blocks.
  generic(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/gi),
  // Credentials embedded in a URL: scheme://[user]:PASSWORD@host (the user may be empty: redis://:pw@host).
  generic(/:\/\/[^\s/:@]*:([^\s/@]+)@/g),
  // Provider token prefixes.
  known(/\b(sk-[A-Za-z0-9_-]{8,})\b/gi),
  known(/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/gi),
  known(/\b(github_pat_[A-Za-z0-9_]{20,})\b/gi),
  known(/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/gi),
  known(/\b(xoxe[.-][A-Za-z0-9._-]{10,})/g),
  known(/\b(xapp-[A-Za-z0-9-]{10,})\b/gi),
  known(/\b(gsk_[A-Za-z0-9_-]{10,})\b/gi),
  known(/\b(AIza[0-9A-Za-z\-_]{20,})\b/gi),
  known(/\b(pplx-[A-Za-z0-9_-]{10,})\b/gi),
  known(/\b(npm_[A-Za-z0-9]{10,})\b/gi),
  // AWS access key ids (long-term AKIA, temporary ASIA).
  known(/\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g),
  // Stripe secret/restricted keys and webhook secrets.
  known(/\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,})\b/g),
  known(/\b(whsec_[A-Za-z0-9]{8,})\b/g),
  // GitLab, Hugging Face, SendGrid.
  known(/\b(glpat-[A-Za-z0-9_-]{20,})/g),
  known(/\b(hf_[A-Za-z0-9]{20,})\b/g),
  known(/\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g),
  // A bare JWT (header.payload.signature, all base64url).
  known(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g),
  // Telegram Bot API URLs embed the token as `/bot<token>/...`.
  known(/\bbot(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi),
  known(/\b(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi),
];

const MIN_LENGTH = 18;
const KEEP_START = 6;
const KEEP_END = 4;

/** `strict` (default): only a recognisable-prefix token keeps its prefix+suffix, every other capture is `***`.
 *  `display`: every long capture keeps prefix+suffix (a log line the operator reads to tell keys apart). */
export type MaskMode = 'strict' | 'display';

/** Mask one secret: `***` when short, else first 6 + last 4. */
export function maskToken(token: string): string {
  if (token.length < MIN_LENGTH) return '***';
  return `${token.slice(0, KEEP_START)}…${token.slice(-KEEP_END)}`;
}

function redactPemBlock(block: string): string {
  const lines = block.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return '***';
  return `${lines[0]}\n…redacted…\n${lines[lines.length - 1]}`;
}

/** Replace one match: mask the captured secret group, in place, never via a replacement STRING (`$&` in a secret). */
export function redactMatch(match: string, groups: Array<string | undefined>, isKnown: boolean, mode: MaskMode = 'strict'): string {
  if (match.includes('PRIVATE KEY-----')) return redactPemBlock(match);
  const token = groups.filter((v): v is string => typeof v === 'string' && v.length > 0).at(-1);
  if (token === undefined) return match;
  const masked = mode === 'display' || isKnown ? maskToken(token) : '***';
  const at = match.lastIndexOf(token);
  return match.slice(0, at) + masked + match.slice(at + token.length);
}

/** Redact secret-shaped substrings from text with `patterns` (default: {@link DEFAULT_SECRET_PATTERNS}). */
export function redactText(text: string, patterns: readonly SecretPattern[] = DEFAULT_SECRET_PATTERNS, mode: MaskMode = 'strict'): string {
  if (!text) return text;
  let next = text;
  for (const { re, known: isKnown } of patterns) {
    next = next.replace(re, (...args: unknown[]) => {
      // replace callback: (match, p1, p2, ..., offset, string) — drop offset+string.
      const groups = args.slice(1, args.length - 2) as Array<string | undefined>;
      return redactMatch(args[0] as string, groups, isKnown === true, mode);
    });
  }
  return next;
}

/** Redact a string with the default set (strict masking). */
export function redactSecrets(text: string): string {
  return redactText(text);
}

/** Redact, THEN cap to `max` chars. */
export function redactThenCap(text: string, max: number): string {
  return redactSecrets(text).slice(0, max);
}

/** The default patterns as `/source/flags` strings (the form a config file carries). */
export function secretPatternSources(): string[] {
  return DEFAULT_SECRET_PATTERNS.map(({ re }) => `/${re.source}/${re.flags}`);
}

/** Compile a configured pattern: `/re/flags` keeps its flags, a bare string is case-insensitive; null when invalid. */
export function compileSecretPattern(raw: string): RegExp | null {
  if (!raw.trim()) return null;
  const match = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (match) {
      const flags = match[2].includes('g') ? match[2] : `${match[2]}g`;
      return new RegExp(match[1], flags);
    }
    return new RegExp(raw, 'gi');
  } catch {
    return null;
  }
}

// ---- structural redaction -------------------------------------------------------------------

/** Normalised (lower-cased, `-`/`_`/`.` removed) key names whose VALUE is a secret whatever its shape. */
const SECRET_KEY_ANYWHERE = /password|passwd|passphrase|credential|secret|privatekey|apikey|accesskey|authorization|cookie/;
const SECRET_KEY_SUFFIX = /token$/;

/** A key whose value is a secret regardless of shape: `password`, `DB_PASSWORD`, `SecretAccessKey`, `SessionToken`, `api_key`, `private_key`, `credentials`, `*_token`, `*_secret`. */
export function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[-_.\s]/g, '');
  return SECRET_KEY_ANYWHERE.test(k) || SECRET_KEY_SUFFIX.test(k);
}

/** Optional size bounds applied AFTER redaction (a log/context budget, not a security control). */
export interface RedactDeepOptions {
  maxDepth?: number;
  /** Per object/array: keep at most this many entries. */
  maxEntries?: number;
  /** Per string: cut to this many chars (after redaction) and mark it `…[truncated]`. */
  maxString?: number;
}

const DEFAULT_MAX_DEPTH = 12;

function walk(value: unknown, depth: number, path: Set<object>, o: RedactDeepOptions): unknown {
  const entries = <T>(list: T[]): T[] => (o.maxEntries === undefined ? list : list.slice(0, o.maxEntries));
  if (typeof value === 'string') {
    const text = redactSecrets(value);
    return o.maxString !== undefined && text.length > o.maxString ? `${text.slice(0, o.maxString)}…[truncated]` : text;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= (o.maxDepth ?? DEFAULT_MAX_DEPTH)) return '[MAX_DEPTH]';
  // `path` holds only the ancestors of the node being visited, so a node shared by two siblings (a DAG) is
  // walked twice and only a true cycle is reported.
  if (path.has(value)) return '[CIRCULAR]';
  path.add(value);
  try {
    if (value instanceof Error) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries(Object.entries(value))) out[k] = isSecretKey(k) && v != null ? '[REDACTED]' : walk(v, depth + 1, path, o);
      out.name = value.name;
      out.message = walk(value.message, depth + 1, path, o);
      out.stack = value.stack ? walk(value.stack, depth + 1, path, o) : null;
      if (value.cause !== undefined) out.cause = walk(value.cause, depth + 1, path, o);
      return out;
    }
    if (Array.isArray(value)) return entries(value).map((entry) => walk(entry, depth + 1, path, o));
    if (value instanceof Set) return entries([...value]).map((entry) => walk(entry, depth + 1, path, o));
    if (value instanceof Map) {
      return entries([...value]).map(([k, v]) => [walk(k, depth + 1, path, o), typeof k === 'string' && isSecretKey(k) && v != null ? '[REDACTED]' : walk(v, depth + 1, path, o)]);
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of entries(Object.entries(value))) {
      // Under a secret key EVERYTHING is masked — nested objects and numbers too, not just strings.
      out[key] = isSecretKey(key) && entry != null && typeof entry !== 'boolean' ? '[REDACTED]' : walk(entry, depth + 1, path, o);
    }
    return out;
  } finally {
    path.delete(value);
  }
}

/**
 * Redact every string leaf of `value` (objects, arrays, Maps, Sets, Errors incl. their own properties and
 * `cause`), masking anything under a secret-named key. Returns a fresh structure of the same shape, so a
 * later `JSON.stringify` is always valid JSON with the secret gone.
 */
export function redactDeep<T>(value: T, options: RedactDeepOptions = {}): T {
  return walk(value, 0, new Set(), options) as T;
}
