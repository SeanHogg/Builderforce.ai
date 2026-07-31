/**
 * Secret redaction for builder-side diagnostics (api / Workers edge runtime).
 *
 * This is an edge-safe port of the core secret-pattern set from the gateway's
 * `agent-runtime/src/logging/redact.ts`. That module can't be imported here: it
 * pulls in `node:module` (`createRequire`) and lazy config loading, neither of
 * which belong in the Cloudflare Workers bundle, and it lives in a separate
 * package. The PATTERNS below are kept in sync with that source of truth — if
 * you add a provider token shape there, mirror it here.
 *
 * Used by the LLM trace logger to scrub request/response bodies of API keys,
 * bearer tokens, and private keys before they are persisted to `llm_traces`.
 */

/** Secret-shaped patterns. Mirror of agent-runtime's DEFAULT_REDACT_PATTERNS. */
const SECRET_PATTERNS: RegExp[] = [
  // ENV-style assignments.
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)\b\s*[=:]\s*(["']?)([^\s"'\\]+)\1/gi,
  // JSON fields.
  /"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken)"\s*:\s*"([^"]+)"/gi,
  // CLI flags.
  /--(?:api[-_]?key|token|secret|password|passwd)\s+(["']?)([^\s"']+)\1/gi,
  // Authorization headers / bearer tokens.
  /Authorization\s*[:=]\s*Bearer\s+([A-Za-z0-9._\-+=]+)/gi,
  /\bBearer\s+([A-Za-z0-9._\-+=]{18,})\b/gi,
  // PEM blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/gi,
  // Common token prefixes.
  /\b(sk-[A-Za-z0-9_-]{8,})\b/gi,
  /\b(ghp_[A-Za-z0-9]{20,})\b/gi,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/gi,
  /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/gi,
  /\b(xapp-[A-Za-z0-9-]{10,})\b/gi,
  /\b(gsk_[A-Za-z0-9_-]{10,})\b/gi,
  /\b(AIza[0-9A-Za-z\-_]{20,})\b/gi,
  /\b(pplx-[A-Za-z0-9_-]{10,})\b/gi,
  /\b(npm_[A-Za-z0-9]{10,})\b/gi,
  // Telegram Bot API URLs embed the token as `/bot<token>/...`.
  /\bbot(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi,
  /\b(\d{6,}:[A-Za-z0-9_-]{20,})\b/gi,
];

const MIN_LENGTH = 18;
const KEEP_START = 6;
const KEEP_END = 4;

function maskToken(token: string): string {
  if (token.length < MIN_LENGTH) return '***';
  return `${token.slice(0, KEEP_START)}…${token.slice(-KEEP_END)}`;
}

function redactPemBlock(block: string): string {
  const lines = block.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return '***';
  return `${lines[0]}\n…redacted…\n${lines[lines.length - 1]}`;
}

/** Replace one match — mask the captured secret group (or the whole match). */
function redactMatch(match: string, groups: Array<string | undefined>): string {
  if (match.includes('PRIVATE KEY-----')) return redactPemBlock(match);
  const token = groups.filter((v): v is string => typeof v === 'string' && v.length > 0).at(-1) ?? match;
  const masked = maskToken(token);
  return token === match ? masked : match.replace(token, masked);
}

/**
 * Redact secret-shaped substrings from arbitrary text. Safe on already-serialized
 * JSON (it operates on the string form). Returns the input unchanged when empty.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let next = text;
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, (...args: unknown[]) => {
      // replace callback: (match, p1, p2, ..., offset, string) — drop offset+string.
      const match = args[0] as string;
      const groups = args.slice(1, args.length - 2) as Array<string | undefined>;
      return redactMatch(match, groups);
    });
  }
  return next;
}
