/**
 * scanForPlaceholders — in-Worker detection of stub/placeholder code an agent
 * committed, so the shell-less cloud loop can BLOCK a `finish` that ships dead
 * scaffolding instead of a real implementation.
 *
 * Motivating failure (exec #53): a weak model, told to "use the existing email
 * infrastructure", instead wrote mock `email.ts`/`accounts.ts`/`logging.ts` ("// In
 * a real implementation, this would…") and re-declared an entire interface with
 * "// Assuming … is already defined" comments. The honesty gate
 * ([assertsUnrunVerification](../runtime/cloudAgentTools.ts)) catches
 * fabricated "tests pass" claims; this is its counterpart for fabricated CODE.
 *
 * Precision over recall (like the honesty gate): the patterns match the explicit
 * "this is a stub" asides a model writes when it scaffolds (`// In a real …`), PLUS
 * structural tells that don't announce themselves in prose — an empty typed
 * function body, a `throw new Error('not implemented')`, a `return null as Foo`
 * cast-to-satisfy-the-signature, a `// TODO`, a hard-coded `@example.com` /
 * `your-api-key` literal. All are kept narrow enough that ordinary finished code
 * does not trip them. We also skip prose/config (`.md`/`.json`/`.yaml`) and
 * test/spec files (which legitimately mock and simulate), so a clean finish is
 * never blocked by a real file. Reads the committed content back via the same
 * `readRepoFile` path as `verifyWrittenFiles`. Never throws.
 */
import { readRepoFile, type RepoReadContext } from './readRepoContents';

/** Files whose placeholder-ish prose is expected/legitimate and must not block. */
const SKIP_EXT = /\.(md|markdown|json|ya?ml|lock|txt|csv|svg|png|jpe?g|gif|ico)$/i;
/** Tests/specs/mocks/fixtures legitimately simulate and mock — never scan them. */
const SKIP_TESTISH = /(^|[./])(__mocks__|__fixtures__|fixtures|mocks)([./]|$)|\.(test|spec|stories)\.[cm]?[jt]sx?$/i;

/** True when a written path should be scanned for stub markers. */
export function isScannablePath(path: string): boolean {
  return !SKIP_EXT.test(path) && !SKIP_TESTISH.test(path);
}

/**
 * High-precision stub markers. Each label names the smell so the agent gets an
 * actionable reason. Kept narrow on purpose — these are phrases a model emits when
 * it deliberately scaffolds, not idioms that appear in finished code.
 */
const STUB_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'placeholder stub comment', re: /\bplaceholder\s+(for|implementation|function|until|that|version)\b|\/\/\s*placeholder\b|\bis\s+(?:just\s+)?a\s+placeholder\b/i },
  { label: '"in a real …" stub aside', re: /\bin\s+a\s+real\s+(system|implementation|scenario|app|application|world|setup|project|service|codebase)\b/i },
  { label: '"in production this would" stub', re: /\bin\s+production,?\s+(?:this|you|the|we|it)\b[^.\n]{0,40}\b(would|will|should|must)\b/i },
  { label: '"assuming … exists/defined" hand-wave', re: /\bassuming\b[^.\n]{0,70}\b(exist|exists|defined|imported|already|globally|elsewhere)\b/i },
  { label: 'not-implemented stub', re: /\bnot\s+implemented\b|\bnotimplemented\b|\bunimplemented\b/i },
  { label: 'simulated I/O stub', re: /\b(simulate|simulating|simulates|simulation)\b[^.\n]{0,30}\b(email|send|network|api|latency|delay|fetch|request|call|response)\b|\bfor\s+this\s+simulation\b/i },
  { label: '"replace with actual" token', re: /\b(to\s+be\s+replaced|replace\s+(?:this\s+)?with\s+(?:the\s+)?actual|substituted?\s+with\s+(?:the\s+)?actual|replace\s+with\s+real)\b/i },
  { label: 'bracketed placeholder token', re: /\[(platform\s+name|your[\s_-][a-z ]+|todo|placeholder|insert[\s_-][a-z ]+)\]/i },
  { label: 'mock value stub', re: /\b(mock|dummy|fake|stub(?:bed)?)\s+(email|data|response|value|implementation|return|account|user|result)\b|\breturn\s+(?:a\s+)?mock\b/i },

  // --- Structural tells: stubs that do NOT announce themselves in a comment. ---
  // A thrown not-implemented/TODO/stub error — unambiguously unfinished.
  { label: 'not-implemented throw', re: /\bthrow\s+new\s+\w*Error\s*\([^)]*\b(not[\s_-]?implemented|unimplemented|not\s+yet|todo|stub)\b|\bNotImplementedError\b/i },
  // `return null/undefined/{}/[]/"" as SomeType` — an empty value cast purely to
  // satisfy a return signature is the classic "I'll fill this in later" stub.
  { label: 'type-cast empty return', re: /\breturn\s+(?:null|undefined|\{\s*\}|\[\s*\]|''|""|``|0|false)\s+as\b/i },
  // A leftover work marker in code the agent just wrote for a task it calls done.
  { label: 'TODO/FIXME marker', re: /(?:\/\/|\/\*|\*)\s*(?:todo|fixme)\b/i },
  // An empty body on a function/arrow with a non-void return type: it can't return
  // what it promises, so it is a stub (and a type error CI would reject). The
  // `= {}` guard means typed object-literal assignments don't match; requiring the
  // empty braces at end-of-line means a `Record<string, {}>` return type doesn't.
  { label: 'empty typed function body', re: /:\s*(?!void\b|Promise<\s*void\s*>|never\b|undefined\b|unknown\b|any\b)[A-Za-z_][\w.<>,\[\] |]*\s*(?:=>\s*)?\{\s*\}[ \t]*$/m },
  // Hard-coded reserved-example data / obvious secret placeholders standing in for
  // a real value or lookup.
  { label: 'placeholder example/secret literal', re: /@example\.(?:com|org|net)\b|['"`][^'"`]{0,40}(?:your[-_ ]?(?:api[-_ ]?key|token|secret)|xxxx+)[^'"`]{0,40}['"`]/i },
  // An unresolved git merge-conflict marker — a committed conflict is unambiguously
  // broken code (won't parse/compile). The start marker `<<<<<<< <ref>` is
  // zero-false-positive: seven `<` at line start followed by whitespace never
  // occurs in finished source.
  { label: 'unresolved merge-conflict marker', re: /^<{7}[ \t].*$[\s\S]*?^>{7}[ \t]/m },
];

/** Return the distinct stub-marker labels present in a file's content. */
export function detectPlaceholderMarkers(content: string): string[] {
  const hits: string[] = [];
  for (const { label, re } of STUB_PATTERNS) {
    if (re.test(content)) hits.push(label);
  }
  return hits;
}

export interface PlaceholderScanResult {
  /** Files that still contain stub markers (the agent must finish or delete them). */
  flagged: Array<{ path: string; markers: string[] }>;
  /** Scannable files that came back clean. */
  clean: string[];
  /** Skipped (config/prose/test/unreadable/truncated). */
  skipped: string[];
}

/**
 * Read each written file back from the branch and flag any that still contain stub
 * markers. Runs only at finish time (one bounded fan-out), so it does not add
 * per-step cost. `ctx.ref` should be the branch the agent committed to.
 */
export async function scanWrittenForPlaceholders(
  ctx: RepoReadContext,
  paths: Iterable<string>,
): Promise<PlaceholderScanResult> {
  const list = [...paths];
  const outcomes = await Promise.all(list.map(async (path): Promise<
    { kind: 'flagged'; path: string; markers: string[] } | { kind: 'clean'; path: string } | { kind: 'skipped'; path: string }
  > => {
    if (!isScannablePath(path)) return { kind: 'skipped', path };
    const rf = await readRepoFile(ctx, path);
    // Unreadable (transient) or truncated for size → don't false-flag.
    if (!rf.ok || rf.truncated) return { kind: 'skipped', path };
    const markers = detectPlaceholderMarkers(rf.content);
    return markers.length ? { kind: 'flagged', path, markers } : { kind: 'clean', path };
  }));

  const flagged: Array<{ path: string; markers: string[] }> = [];
  const clean: string[] = [];
  const skipped: string[] = [];
  for (const o of outcomes) {
    if (o.kind === 'flagged') flagged.push({ path: o.path, markers: o.markers });
    else if (o.kind === 'clean') clean.push(o.path);
    else skipped.push(o.path);
  }
  return { flagged, clean, skipped };
}
