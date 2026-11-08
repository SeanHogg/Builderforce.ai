/**
 * @builderforce/secret-redaction — THE secret redactor.
 *
 * Consumers: the api (`infrastructure/security/redactSecrets.ts`, which adds the
 * `tool_audit_events` row helper), agent-runtime (`logging/redact.ts`, which adds its
 * config overlay), the diff scanner, the connector/package reviewers and the improvement-prompt
 * scrubber. They all share this pattern set; nothing is hand-synced.
 *
 * Entry points:
 *   - {@link redactText}     scrub a string with a pattern set.
 *   - {@link redactJsonText} scrub a string that MAY be JSON text: parsed, redacted structurally, re-serialised.
 *   - {@link redactDeep}     scrub every string LEAF of a value (so a structure that is later
 *                            JSON-stringified stays valid JSON and a quoted secret cannot hide
 *                            behind escaping), masking whatever sits under a secret-named key.
 *   - {@link redactThenCap}  redact BEFORE truncating: a cap that cuts a token in half leaves a
 *                            fragment no pattern recognises.
 *   - {@link SECRET_SHAPES} / {@link findSecretShapes}  the recognisable-prefix token shapes, for detection-only callers.
 *
 * Never run text-mode redaction over a JSON.stringify'd blob you built yourself: escaping hides quoted
 * secrets. Walk the value with {@link redactDeep}, then stringify. A string that arrives as JSON TEXT
 * goes through {@link redactJsonText} (also what {@link redactDeep} does for a string leaf that parses as
 * an object/array, so `execution.payload` / `result` columns are redacted structurally).
 */

/** One secret shape. `known` = a provider token with a recognisable prefix, safe to show prefix+suffix of. */
export interface SecretPattern {
  re: RegExp;
  known?: boolean;
  /** Stable id (used as the label by callers that replace a span with a tag). */
  id?: string;
}

/**
 * A recognisable-prefix credential shape. The ONE list: redaction uses it, and detection-only callers
 * (content trust, package review) read it instead of keeping their own prefix lists.
 * Group 1 is the token itself.
 */
export interface SecretShape {
  id: string;
  label: string;
  re: RegExp;
}

const shape = (id: string, label: string, re: RegExp): SecretShape => ({ id, label, re });

export const SECRET_SHAPES: readonly SecretShape[] = [
  // PEM blocks. An unterminated block (a capped tool output) is redacted to the end of the text: the body is the secret.
  shape('private-key', 'private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[\s\S]*)/gi),
  // OpenAI / Anthropic / OpenRouter style keys: `sk-proj-…`, `sk-ant-api03-…`, legacy `sk-` + base62. A bare `sk-` needs a
  // hyphen-free run of 16+ chars, so a package name like `sk-learn-components` is not a key.
  shape('openai-key', 'OpenAI-style key', /\b(sk-(?:(?:proj|svcacct|admin|ant\d*|or-v\d)-[A-Za-z0-9_-]{16,}|[A-Za-z0-9_]{16,}))(?![A-Za-z0-9_])/gi),
  shape('github-token', 'GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/gi),
  shape('github-pat', 'GitHub fine-grained token', /\b(github_pat_[A-Za-z0-9_]{20,})\b/gi),
  shape('slack-token', 'Slack token', /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/gi),
  shape('slack-rotating-token', 'Slack rotating token', /\b(xoxe[.-][A-Za-z0-9._-]{10,})/g),
  shape('slack-app-token', 'Slack app token', /\b(xapp-[A-Za-z0-9-]{10,})\b/gi),
  shape('groq-key', 'Groq key', /\b(gsk_[A-Za-z0-9_-]{10,})\b/gi),
  shape('google-api-key', 'Google API key', /\b(AIza[0-9A-Za-z\-_]{20,})\b/gi),
  shape('google-oauth-token', 'Google OAuth access token', /\b(ya29\.[A-Za-z0-9_-]{20,})/g),
  shape('google-client-secret', 'Google OAuth client secret', /\b(GOCSPX-[A-Za-z0-9_-]{20,})/g),
  shape('perplexity-key', 'Perplexity key', /\b(pplx-[A-Za-z0-9_-]{10,})\b/gi),
  shape('npm-token', 'npm token', /\b(npm_[A-Za-z0-9]{10,})\b/gi),
  // AWS access key ids (long-term AKIA, temporary ASIA).
  shape('aws-access-key', 'AWS access key id', /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g),
  // Stripe secret/restricted keys and webhook secrets.
  shape('stripe-key', 'Stripe secret key', /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{8,})\b/g),
  shape('stripe-webhook-secret', 'Stripe webhook secret', /\b(whsec_[A-Za-z0-9]{8,})\b/g),
  shape('gitlab-token', 'GitLab token', /\b(glpat-[A-Za-z0-9_-]{20,})/g),
  shape('huggingface-token', 'Hugging Face token', /\b(hf_[A-Za-z0-9]{20,})\b/g),
  shape('sendgrid-key', 'SendGrid key', /\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g),
  // Our own credentials: `<prefix>_<hex>` (api `generateApiKey`): bfk workspace, bfa agent-host, bfr site, bfq/bff/bfx ingest and
  // LRS keys, clk/clu legacy agent-host keys.
  shape('builderforce-key', 'BuilderForce API key', /\b((?:bf[a-z]|cl[ku])_[A-Za-z0-9]{8,})\b/g),
  // A bare JWT (header.payload.signature, all base64url).
  shape('jwt', 'JSON web token', /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g),
  // Telegram Bot API URLs embed the token as `/bot<token>/...`.
  shape('telegram-bot-url', 'Telegram bot token', /\bbot(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi),
  shape('telegram-bot-token', 'Telegram bot token', /\b(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi),
];

/** The shapes found in `text` (detection only; nothing is changed). */
export function findSecretShapes(text: string): SecretShape[] {
  const found: SecretShape[] = [];
  for (const s of SECRET_SHAPES) {
    s.re.lastIndex = 0;
    if (s.re.test(text)) found.push(s);
    s.re.lastIndex = 0;
  }
  return found;
}

// ---- assignment patterns -----------------------------------------------------------------------

// Value forms. A value is quoted (plain or JSON-escaped `\"…\"`) or a run that never contains a backslash:
// a lone `\` captured into a value is what used to corrupt escaped JSON text (`API_TOKEN=\"x\" run`).
const TYPE_WORD = String.raw`(?:string|number|boolean|null|undefined|true|false)`;
const VALUE_ENV = String.raw`(?:\\"([^"\\\n]*)\\"|"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)'|([^\s"'\\]+))`;
// A lower-case assignment is also prose and source code, so it needs a secret-LIKE value: quoted 3+ chars that is not a
// bare type word, or an unquoted run of 6+ that is not a type word, not a call (`getToken()`) and not a dotted member path
// (`process.env.X;`). An unquoted value may contain `;` (it stops at whitespace, quotes, `,` and `&`).
// `NOT_MASKED`: a value an earlier pattern already masked in `display` mode (`abcdef…ghij`) is not masked again down to `***`.
const NOT_MASKED = String.raw`(?![^\s"'\\]*…)`;
const VALUE_CONFIG =
  String.raw`(?:\\"${NOT_MASKED}(?!${TYPE_WORD}\\")([^"\\\n]{3,})\\"|"${NOT_MASKED}(?!${TYPE_WORD}")([^"\\\n]{3,})"|'${NOT_MASKED}(?!${TYPE_WORD}')([^'\\\n]{3,})'|` +
  String.raw`${NOT_MASKED}(?!${TYPE_WORD}\b)(?![A-Za-z_$][\w$.]*\()(?![A-Za-z_$][\w$]*(?:\.[\w$]+)+;?(?:[\s"',&)\]}\\]|$))([^\s"',&\\]{6,})(?=[\s"',&)\]}\\]|$))`;
const SECRET_WORD = String.raw`(?:password|passwd|passphrase|secret|token|api[-_]?key|private[-_]?key|access[-_]?key)`;

/** The pattern set. Order matters only in that assignments run before prefix shapes. */
export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  // ENV-style assignments: an UPPER_CASE name in which KEY/TOKEN/SECRET/PASSWORD/PASSWD is a whole `_`-delimited word
  // (`SECRET_KEY_BASE=…`, `API_KEY_2=…`, `GITHUB_TOKEN=…`), so `MONKEY` / `HOTKEY` are not assignments; `isBenignKey` then skips
  // a name that is a reference or a database/cache key (`TOKEN_COUNT`, `KEY_ID`, `PRIMARY_KEY`, `SORT_KEY`). Case-sensitive.
  // The value may be quoted and contain spaces. NO nested quantifiers: the lookahead finds the word once, the name is one
  // unambiguous run (a regex that is quadratic or exponential here is a ReDoS on attacker-controlled tool output).
  { id: 'env-assignment', re: new RegExp(String.raw`(?<![A-Za-z0-9_])(?=(?:[A-Z0-9]+_+)*?(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|APIKEY)(?![A-Z0-9]))(?<key>[A-Z][A-Z0-9]*(?:_+[A-Z0-9]+)*)\s*[=:]\s*${VALUE_ENV}`, 'g') },
  // Lower-case / camelCase / snake_case config, CLI and source assignments (`password=hunter2`, `export github_token=…`,
  // `refresh_token=…`), only for a name containing a secret word and a secret-LIKE value. The key is ONE `[\w-]+` run found by
  // a lookahead (no nested quantifier, starts only at a run boundary) and `isBenignKey` then judges the whole captured key.
  { id: 'assignment', re: new RegExp(String.raw`(?<![\w-])(?=[\w-]*?${SECRET_WORD})(?<key>[\w-]+)\s*[=:]\s*${VALUE_CONFIG}`, 'gi') },
  // JSON fields inside text, any spelling of the key (`apiKey`, `access_token`, `client_secret`).
  { id: 'json-field', re: new RegExp(String.raw`"(?=[\w.-]*?${SECRET_WORD})(?<key>[\w.-]+)"\s*:\s*"((?:[^"\\]|\\.)+)"`, 'gi') },
  // CLI flags (`--token x`, `--token "x"`, `--token=x`).
  { id: 'cli-flag', re: /--(?:api[-_]?key|token|secret|password|passwd)(?:\s+|=)(\\"|["']?)([^\s"'\\]+)\1/gi },
  // Authorization headers: a scheme (`Bearer x`, `Basic x`, `token x`) or a bare token-shaped credential (20+ chars with a digit).
  // `Authorization: denied for user` is prose, not a credential.
  { id: 'authorization', re: /Authorization\s*[:=]\s*(?:(?:Bearer|Basic|Token|Digest|Negotiate|ApiKey|OAuth)\s+([A-Za-z0-9._\-+=/~]{8,})|(?=[A-Za-z0-9._\-+=/~]*\d)([A-Za-z0-9._\-+=/~]{20,}))/gi },
  { id: 'bearer', re: /\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b/gi },
  // Credentials embedded in a URL: scheme://[user]:PASSWORD@host (the user may be empty: redis://:pw@host).
  { id: 'url-credential', re: /:\/\/[^\s/:@]*:([^\s/@\\"]+)@/g },
  // Provider token prefixes (PEM blocks included).
  ...SECRET_SHAPES.map(({ id, re }) => ({ id, re, known: true })),
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

/** Mask a credential for a settings screen: only the last 4 chars show (`****abcd`), `****` when 4 or fewer. */
export function maskTail(token: string): string {
  if (token.length <= 4) return '****';
  return `****${token.slice(-4)}`;
}

function redactPemBlock(block: string): string {
  const lines = block.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return '***';
  const last = lines[lines.length - 1]!;
  // No END marker (a capped output): the last line is key body, never show it.
  if (!/-----END /.test(last)) return `${lines[0]}\n…redacted…`;
  return `${lines[0]}\n…redacted…\n${last}`;
}

/**
 * Replace one match: mask the captured secret group, in place, never via a replacement STRING (`$&` in a secret).
 * `mask` replaces the computed masking (a caller that tags the span, e.g. `[REDACTED:id]`).
 */
export function redactMatch(match: string, groups: Array<string | undefined>, isKnown: boolean, mode: MaskMode = 'strict', mask?: string): string {
  if (match.includes('PRIVATE KEY-----')) return mask ?? redactPemBlock(match);
  const token = groups.filter((v): v is string => typeof v === 'string' && v.length > 0).at(-1);
  if (token === undefined) return match;
  const masked = mask ?? (mode === 'display' || isKnown ? maskToken(token) : '***');
  const at = match.lastIndexOf(token);
  return match.slice(0, at) + masked + match.slice(at + token.length);
}

/** Redact secret-shaped substrings from text with `patterns` (default: {@link DEFAULT_SECRET_PATTERNS}). */
export function redactText(
  text: string,
  patterns: readonly SecretPattern[] = DEFAULT_SECRET_PATTERNS,
  mode: MaskMode = 'strict',
  label?: (patternId: string) => string,
): string {
  if (!text) return text;
  let next = text;
  for (const { re, known: isKnown, id } of patterns) {
    next = next.replace(re, (...args: unknown[]) => {
      // replace callback: (match, p1, p2, ..., offset, string[, namedGroups]) — drop offset+string(+named).
      const last = args[args.length - 1];
      const named = typeof last === 'object' && last !== null ? (last as Record<string, string | undefined>) : undefined;
      let groups = args.slice(1, args.length - (named ? 3 : 2)) as Array<string | undefined>;
      if (named && 'key' in named) {
        // `(?<key>…)` is always the first group: it names the assignment, it is never the secret.
        if (named.key !== undefined && isBenignKey(named.key)) return args[0] as string;
        groups = groups.slice(1);
      }
      return redactMatch(args[0] as string, groups, isKnown === true, mode, label ? label(id ?? 'secret') : undefined);
    });
  }
  return next;
}

/** Redact a string with the default set (strict masking). */
export function redactSecrets(text: string): string {
  return redactText(text);
}

/**
 * Redact a string that MAY be JSON text. When it parses as an object/array it is redacted structurally
 * (so a mask can never break the JSON and an escaped quoted secret cannot hide), keeping its exact form
 * when nothing changed; otherwise (prose that starts with `{`/`[`, or not JSON at all) as plain text.
 * Never throws.
 */
export function redactJsonText(text: string, options: RedactDeepOptions = {}): string {
  return redactJsonTextAt(text, options, 0);
}

/** A JSON document whose number tokens a parse/stringify round trip would change: an integer of 16+ digits (above 2^53) or a huge exponent (`1e400` -> null). */
const LOSSY_NUMBER = /(?<![\w."])-?\d{16,}|\d[eE][+-]?\d{3,}/;
/** Text-mode redaction above this size: parsing and re-serialising a megabyte string per leaf is unbounded work. */
const MAX_JSON_PARSE_CHARS = 1_048_576;
/** How many levels of JSON-inside-a-JSON-string are parsed before a string leaf is treated as plain text. */
const MAX_JSON_NESTING = 3;

function redactJsonTextAt(text: string, options: RedactDeepOptions, jsonDepth: number): string {
  if (!text) return text;
  const first = text.trimStart()[0];
  if (first !== '{' && first !== '[') return redactSecrets(text);
  // Text mode where structural mode would be lossy or unbounded. Accepted loss: duplicate keys in an object collapse
  // to the last one when the structural path re-serialises (`{"a":1,"a":2}` -> `{"a":2}`); big numbers are not accepted
  // loss, hence the text-mode fallback for them.
  if (jsonDepth >= MAX_JSON_NESTING || text.length > MAX_JSON_PARSE_CHARS || LOSSY_NUMBER.test(text)) return redactSecrets(text);
  try {
    const parsed: unknown = JSON.parse(text);
    const clean = JSON.stringify(walk(parsed, 0, newWalkContext(options, jsonDepth + 1)));
    return clean === JSON.stringify(parsed) ? text : clean;
  } catch {
    // Not JSON after all: the text form is the fail-safe. A redactor must never throw into its caller.
    return redactSecrets(text);
  }
}

/** Redact, THEN cap to `max` chars (JSON text is redacted structurally first). */
export function redactThenCap(text: string, max: number): string {
  return redactJsonText(text).slice(0, max);
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
      const [, body = '', flagsRaw = ''] = match;
      const flags = flagsRaw.includes('g') ? flagsRaw : `${flagsRaw}g`;
      return new RegExp(body, flags);
    }
    return new RegExp(raw, 'gi');
  } catch {
    return null;
  }
}

// ---- structural redaction -------------------------------------------------------------------

/** Normalised (lower-cased, `-`/`_`/`.` removed) key names whose VALUE is a secret whatever its shape. */
// `secret` is not `secretary` / `secretly`; a URL/URI to a token (`signedTokenUrl`, `tokenUri`) is itself a bearer credential.
const SECRET_KEY_ANYWHERE = /password|passwd|passphrase|credential|secret(?!ar|ly)|privatekey|apikey|accesskey|authorization|cookie/;
const SECRET_KEY_SUFFIX = /token(?:url|uri)?$/;

/**
 * A key whose LAST word says it is not a secret but a reference to / a fact about one: `credentialId`, `secretCount`,
 * `apiKeyName`, `cookieConsent`, `passwordPolicy`, `cookiesEnabled`, `authorizationStatus`, `credentialsProvided`.
 * Deliberately NOT `url` / `uri` / `path` / `file`: `webhookSecretUrl` and `signedTokenUrl` carry the credential.
 */
const BENIGN_LAST_WORDS: ReadonlySet<string> = new Set([
  'id', 'ids', 'count', 'name', 'consent', 'type', 'length',
  'policy', 'status', 'enabled', 'provided', 'provider', 'mode', 'kind', 'required',
]);
/** `PRIMARY_KEY`, `SORT_KEY`, `HOT_KEY`…: a database / cache / UI key, not a credential. */
const NON_SECRET_KEY_QUALIFIERS: ReadonlySet<string> = new Set([
  'primary', 'foreign', 'sort', 'partition', 'cache', 'hot', 'shortcut', 'row', 'index', 'hash', 'lookup', 'unique', 'composite',
]);
/** `nextPageToken`, `pageToken`, `continuationToken`: pagination cursors, not credentials. */
const CURSOR_WORDS: ReadonlySet<string> = new Set(['page', 'next', 'prev', 'previous', 'continuation']);

function keyWords(key: string): string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_.-]+/).filter(Boolean);
}

/** A key that mentions a secret word but names an id / count / name / cursor / flag about it, not the secret. */
export function isBenignKey(key: string): boolean {
  const words = keyWords(key);
  const last = words.at(-1);
  if (last === undefined) return false;
  if (BENIGN_LAST_WORDS.has(last)) return true;
  if (last === 'key' && words.length > 1 && NON_SECRET_KEY_QUALIFIERS.has(words[words.length - 2]!)) return true;
  return last === 'token' && words.length > 1 && CURSOR_WORDS.has(words[words.length - 2]!);
}

/** A key whose value is a secret regardless of shape: `password`, `DB_PASSWORD`, `SecretAccessKey`, `SessionToken`, `api_key`, `private_key`, `credentials`, `*_token`, `*_secret`. */
export function isSecretKey(key: string): boolean {
  if (isBenignKey(key)) return false;
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

/** Keys whose object value is a map of NAMED SUBSCHEMAS (JSON Schema): a child called `password` is a field definition, not a secret. */
const SCHEMA_MAP_KEYS: ReadonlySet<string> = new Set(['properties', 'patternProperties', '$defs', 'definitions']);

interface WalkContext {
  options: RedactDeepOptions;
  /** Only the ancestors of the node being visited, so a node shared by two siblings (a DAG) is walked and a true cycle is reported. */
  path: Set<object>;
  /** Finished nodes by `depth|schemaMap`, so a shared node is walked once per depth, not once per path (F^D blow-up). */
  done: WeakMap<object, Map<string, unknown>>;
  /** How many JSON-text-inside-a-string levels deep this walk already is (bounds `redactJsonTextAt` recursion). */
  jsonDepth: number;
  /** Count of `[CIRCULAR]` markers emitted so far: a node whose subtree emitted one is path-dependent and is not memoised. */
  circularHits: number;
}

const newWalkContext = (options: RedactDeepOptions, jsonDepth: number): WalkContext =>
  ({ options, path: new Set(), done: new WeakMap(), jsonDepth, circularHits: 0 });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Map) && !(v instanceof Set) && !(v instanceof Error);

function walk(value: unknown, depth: number, ctx: WalkContext, schemaMap = false): unknown {
  const o = ctx.options;
  const entries = <T>(list: T[]): T[] => (o.maxEntries === undefined ? list : list.slice(0, o.maxEntries));
  if (typeof value === 'string') {
    // A string leaf that is itself JSON text (an `execution.payload` / `result` column) is redacted structurally.
    // The caller's options flow through; nesting depth and size are bounded inside `redactJsonTextAt`.
    const text = redactJsonTextAt(value, o, ctx.jsonDepth);
    return o.maxString !== undefined && text.length > o.maxString ? `${text.slice(0, o.maxString)}…[truncated]` : text;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (depth >= (o.maxDepth ?? DEFAULT_MAX_DEPTH)) return '[MAX_DEPTH]';
  if (ctx.path.has(value)) return '[CIRCULAR]';
  const memoKey = `${depth}|${schemaMap ? 1 : 0}`;
  const memo = ctx.done.get(value)?.get(memoKey);
  if (memo !== undefined) return memo;
  ctx.path.add(value);
  try {
    const result = walkNode(value, depth, ctx, schemaMap, entries);
    let byDepth = ctx.done.get(value);
    if (!byDepth) ctx.done.set(value, (byDepth = new Map()));
    byDepth.set(memoKey, result);
    return result;
  } finally {
    ctx.path.delete(value);
  }
}

function walkNode(value: object, depth: number, ctx: WalkContext, schemaMap: boolean, entries: <T>(list: T[]) => T[]): unknown {
  if (value instanceof Error) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries(Object.entries(value))) out[k] = isSecretKey(k) && v != null ? '[REDACTED]' : walk(v, depth + 1, ctx);
    out.name = value.name;
    out.message = walk(value.message, depth + 1, ctx);
    out.stack = value.stack ? walk(value.stack, depth + 1, ctx) : null;
    if (value.cause !== undefined) out.cause = walk(value.cause, depth + 1, ctx);
    // `AggregateError.errors` is non-enumerable, so `Object.entries` above never sees it.
    if (typeof AggregateError !== 'undefined' && value instanceof AggregateError) {
      out.errors = entries(Array.from(value.errors as unknown[])).map((entry) => walk(entry, depth + 1, ctx));
    }
    return out;
  }
  if (Array.isArray(value)) return entries(value).map((entry) => walk(entry, depth + 1, ctx));
  if (value instanceof Set) return entries([...value]).map((entry) => walk(entry, depth + 1, ctx));
  if (value instanceof Map) {
    return entries([...value]).map(([k, v]) => [walk(k, depth + 1, ctx), typeof k === 'string' && isSecretKey(k) && v != null ? '[REDACTED]' : walk(v, depth + 1, ctx)]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of entries(Object.entries(value))) {
    // Under a secret key EVERYTHING is masked — nested objects and numbers too, not just strings — except a JSON-Schema
    // field definition (`properties.password` is an object describing the field, not a value).
    const isFieldDefinition = schemaMap && isPlainObject(entry);
    out[key] = isSecretKey(key) && entry != null && typeof entry !== 'boolean' && !isFieldDefinition
      ? '[REDACTED]'
      : walk(entry, depth + 1, ctx, SCHEMA_MAP_KEYS.has(key) && isPlainObject(entry));
  }
  return out;
}

/**
 * Redact every string leaf of `value` (objects, arrays, Maps, Sets, Errors incl. their own properties,
 * `cause` and `AggregateError.errors`), masking anything under a secret-named key. Returns a fresh structure
 * of the same shape, so a later `JSON.stringify` is always valid JSON with the secret gone.
 */
export function redactDeep<T>(value: T, options: RedactDeepOptions = {}): T {
  return walk(value, 0, { options, path: new Set(), done: new WeakMap() }) as T;
}
