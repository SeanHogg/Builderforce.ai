import { buildFinding } from './finding.js';
import { ruleReadsPath, SCAN_PROFILES, isInertAssetPath, type ScanProfileId } from './profiles.js';
import { scanManifest } from './rules/manifestRules.js';
import { TEST_OR_FIXTURE, type Rule } from './rules/rule.js';
import { actionFor, riskScore, worstAction } from './scoring.js';
import { BUILT_IN_SIGNATURES, sha256Hex, type SignatureSource } from './signatures.js';
import type { FileVerdict, IncompleteReason, ScanFinding, ScanReport, ScanSubject, ThreatCategory } from './types.js';

/** Per-line caps keep the regexes cheap; a secret may sit in a minified bundle (one huge line), so its cap is far larger. */
const LINE_CAP = 2_000;
const SECRET_LINE_CAP = 500_000;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_DEADLINE_MS = 5_000;
const BINARY_SNIFF_BYTES = 8_000;

const norm = (path: string): string => path.replace(/\\/g, '/');

function lineOfIndex(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

function ruleFinding(rule: Rule, path: string, line: number): ScanFinding {
  const severity = rule.testPathSeverity && TEST_OR_FIXTURE.test(path) ? rule.testPathSeverity : rule.severity;
  return buildFinding({
    ruleId: rule.id, category: rule.category, severity, weight: rule.weight, title: rule.title,
    remediation: rule.remediation, path, line, cwe: rule.cwe, attack: rule.attack,
  });
}

function scanWithRule(rule: Rule, path: string, text: string, lines: () => string[]): ScanFinding[] {
  if (rule.requiresContext && !rule.requiresContext.test(text)) return [];
  if (rule.scope === 'source') {
    const match = rule.pattern.exec(text);
    if (!match || (rule.accept && !rule.accept(match, text))) return [];
    return [ruleFinding(rule, path, lineOfIndex(text, match.index))];
  }
  const cap = rule.category === 'secret' ? SECRET_LINE_CAP : LINE_CAP;
  const out: ScanFinding[] = [];
  lines().forEach((line, i) => {
    if (line.length > cap) return;
    const match = rule.pattern.exec(line);
    if (match && (!rule.accept || rule.accept(match, line))) out.push(ruleFinding(rule, path, i + 1));
  });
  return out;
}

/**
 * Run the profile's rules (and, for `package.json`, the manifest heuristics) over one text file.
 * Synchronous and pure. Findings carry the rule, path and line, NEVER the matched text.
 */
export function scanText(
  subject: { readonly path: string; readonly content: string },
  profileId: ScanProfileId,
  only?: readonly ThreatCategory[],
): ScanFinding[] {
  const profile = SCAN_PROFILES[profileId];
  const path = norm(subject.path);
  const text = subject.content;
  let split: string[] | undefined;
  const lines = (): string[] => (split ??= text.split('\n'));
  const out: ScanFinding[] = [];
  for (const ruleSet of profile.ruleSets) {
    for (const rule of ruleSet) {
      if (only && !only.includes(rule.category)) continue;
      if (!ruleReadsPath(rule, path) || rule.skipPaths?.test(path)) continue;
      out.push(...scanWithRule(rule, subject.path, text, lines));
    }
  }
  if (profile.manifest && /(^|\/)package\.json$/.test(path)) {
    out.push(...scanManifest(subject.path, text).filter((f) => !only || only.includes(f.category)));
  }
  return out;
}

export interface VerdictCache {
  get(sha256: string, profile: ScanProfileId): FileVerdict | undefined;
  set(verdict: FileVerdict, profile: ScanProfileId): void;
}

/** An LRU keyed by content hash + profile. OPFS / IndexedDB caches can sit behind the same interface. */
export function createMemoryVerdictCache(max = 5000): VerdictCache {
  const entries = new Map<string, FileVerdict>();
  const key = (sha256: string, profile: ScanProfileId): string => `${profile}:${sha256}`;
  return {
    get(sha256, profile) {
      const k = key(sha256, profile);
      const hit = entries.get(k);
      if (hit) { entries.delete(k); entries.set(k, hit); }
      return hit;
    },
    set(verdict, profile) {
      const k = key(verdict.sha256, profile);
      entries.delete(k);
      entries.set(k, verdict);
      if (entries.size > max) entries.delete(entries.keys().next().value as string);
    },
  };
}

export interface ScanOptions {
  readonly profile: ScanProfileId;
  /** Files larger than this are reported incomplete, not scanned. Default 1 MiB. */
  readonly maxFileBytes?: number;
  /** Wall-clock budget for the whole batch. Default 5 s. */
  readonly deadlineMs?: number;
  readonly cache?: VerdictCache;
  /** Extra bad-hash feeds, checked alongside the built-in list. */
  readonly signatures?: SignatureSource;
  readonly signal?: AbortSignal;
}

const incomplete = (path: string, sha256: string, reason: IncompleteReason): FileVerdict => ({
  path, sha256, score: 0, action: 'review', complete: false, incompleteReason: reason, findings: [],
});

/** The file's text, or undefined when it is binary (a NUL byte early on, or not valid UTF-8). */
function decodeText(content: string | Uint8Array): string | undefined {
  if (typeof content === 'string') return content;
  if (content.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content);
  } catch {
    // error-logging: invalid UTF-8 simply means "binary"; the caller reports binary-unsupported, never clean
    return undefined;
  }
}

function verdictFor(path: string, sha256: string, findings: readonly ScanFinding[]): FileVerdict {
  const score = riskScore(findings);
  return { path, sha256, score, action: actionFor(score, findings), complete: true, findings };
}

async function scanOne(subject: ScanSubject, options: ScanOptions, deadline: number): Promise<FileVerdict> {
  const { profile, maxFileBytes = DEFAULT_MAX_FILE_BYTES, cache, signal } = options;
  if (signal?.aborted || Date.now() > deadline) return incomplete(subject.path, '', 'deadline');
  const sha256 = await sha256Hex(subject.content);
  const cached = cache?.get(sha256, profile);
  // Findings depend on the path (test paths, `package.json`), so a hit under another path is not reused.
  if (cached && cached.path === subject.path) return cached;

  const signatureHit = SCAN_PROFILES[profile].signatures && (BUILT_IN_SIGNATURES.has(sha256) || options.signatures?.has(sha256));
  let verdict: FileVerdict;
  if (signatureHit) {
    verdict = verdictFor(subject.path, sha256, [buildFinding({
      ruleId: 'signature.known-bad-hash', category: 'malware-signature', severity: 'CRITICAL', weight: 100,
      title: 'File matches a known-malicious SHA-256', remediation: 'Remove the file.', path: subject.path,
    })]);
  } else if (isInertAssetPath(subject.path)) {
    verdict = verdictFor(subject.path, sha256, []);
  } else {
    const size = typeof subject.content === 'string' ? subject.content.length : subject.content.byteLength;
    if (size > maxFileBytes) return incomplete(subject.path, sha256, 'too-large');
    const text = decodeText(subject.content);
    if (text === undefined) return incomplete(subject.path, sha256, 'binary-unsupported');
    verdict = verdictFor(subject.path, sha256, scanText({ path: subject.path, content: text }, profile));
  }
  cache?.set(verdict, profile);
  return verdict;
}

/**
 * Scan a batch: hash, consult the cache and signatures, then the text rules. Anything not fully scanned
 * (too large, binary, deadline, abort, error) is reported `complete: false` with action `review` and is
 * NEVER cached or reported as clean.
 */
export async function scanSubjects(subjects: readonly ScanSubject[], options: ScanOptions): Promise<ScanReport> {
  const deadline = Date.now() + (options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const files: FileVerdict[] = [];
  for (const subject of subjects) {
    try {
      files.push(await scanOne(subject, options, deadline));
    } catch {
      // error-logging: a scanner fault must fail to INCOMPLETE (never to clean); the verdict carries reason 'error'
      files.push(incomplete(subject.path, '', 'error'));
    }
  }
  return {
    files,
    complete: files.every((f) => f.complete),
    score: files.reduce((max, f) => Math.max(max, f.score), 0),
    action: files.reduce((worst, f) => worstAction(worst, f.action), 'allow' as FileVerdict['action']),
  };
}
