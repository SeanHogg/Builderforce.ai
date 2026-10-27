/**
 * policy/guards/sourcePolicy.ts — the shell-free source/config policy the post-edit
 * check (D7) and the finish gate apply to a run's changed files.
 *
 * Ported from `api/src/application/repos/verifyWrittenFiles.ts` + its
 * `sourceQualityPolicy.ts`. Scope is honest and dependency-light:
 *   - JSON syntax is parsed exactly;
 *   - changed TS/JS is evaluated by source-only, low-false-positive quality rules.
 * YAML is parsed by a small structural check rather than the `yaml` package, because
 * this package is dependency-free (zero runtime deps) — malformed YAML that breaks a
 * build is still caught by the indentation/tab and unbalanced-bracket checks, and the
 * finish gate's branch CI remains the authoritative gate.
 *
 * `checkFileContent` is the per-file policy on bytes already in hand — the post-edit
 * check runs it on a `write_file`'s content without a read back. Never throws.
 *
 * No `node:*` imports, no DOM.
 */

export type VerifyError = { path: string; message: string; line?: number; ruleId?: string };

export interface VerifyResult {
  /** False when any statically-checkable file failed to parse. */
  ok: boolean;
  /** Files that passed an applicable syntax/source policy. */
  checked: string[];
  /** Files with no applicable policy, or which were unreadable/truncated. */
  skipped: string[];
  /** Parse failures / policy findings the agent must fix. */
  errors: VerifyError[];
}

const JSON_EXT = /\.json$/i;
const YAML_EXT = /\.ya?ml$/i;
const SOURCE_EXT = /\.[cm]?[jt]sx?$/i;

/** Whether any shell-free policy applies to this path. */
export function isVerifiablePath(path: string): boolean {
  return JSON_EXT.test(path) || YAML_EXT.test(path) || SOURCE_EXT.test(path);
}

// ── The TS/JS source-quality policy (ported from sourceQualityPolicy.ts) ─────

export interface SourceQualityFinding {
  ruleId: string;
  line: number;
  message: string;
}

const TS_SOURCE = /\.[cm]?[jt]sx?$/i;

/**
 * Conditional JSX expressions do not reliably preserve contextual typing across
 * package declaration / React component boundaries. Require explicit typing here:
 *
 *   onSetVisibility={isOwner ? async (v) => ... : undefined}
 *
 * Ordinary contextually typed callbacks (`rows.map((row) => ...)`) are deliberately
 * outside this rule.
 */
const CONDITIONAL_JSX_CALLBACK =
  /\b(on[A-Z][A-Za-z0-9_$]*)\s*=\s*\{[^{}]{0,300}\?\s*(?:async\s*)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*=>/g;

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Blank comments and string/template literals while preserving offsets/newlines.
 * Policy rules inspect executable source, never examples in docs, tests, or comments. */
function maskNonCode(source: string): string {
  const chars = [...source];
  type State = "code" | "single" | "double" | "template" | "line-comment" | "block-comment";
  let state: State = "code";
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]!;
    const next = chars[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { chars[i] = chars[i + 1] = " "; state = "line-comment"; i += 1; }
      else if (c === "/" && next === "*") { chars[i] = chars[i + 1] = " "; state = "block-comment"; i += 1; }
      else if (c === "'") { chars[i] = " "; state = "single"; }
      else if (c === '"') { chars[i] = " "; state = "double"; }
      else if (c === "`") { chars[i] = " "; state = "template"; }
      continue;
    }
    if (c === "\n" && state === "line-comment") { state = "code"; continue; }
    if (c === "\n") continue;
    const escaped = i > 0 && source[i - 1] === "\\";
    if (state === "block-comment" && c === "*" && next === "/") {
      chars[i] = chars[i + 1] = " "; state = "code"; i += 1; continue;
    }
    chars[i] = " ";
    if (!escaped && (
      (state === "single" && c === "'")
      || (state === "double" && c === '"')
      || (state === "template" && c === "`")
    )) state = "code";
  }
  return chars.join("");
}

/** The TS/JS quality rules, applied to executable source only. */
export function inspectAgentSource(path: string, source: string): SourceQualityFinding[] {
  if (!TS_SOURCE.test(path)) return [];
  const findings: SourceQualityFinding[] = [];
  for (const match of maskNonCode(source).matchAll(CONDITIONAL_JSX_CALLBACK)) {
    const prop = match[1]!;
    const parameter = match[2]!;
    findings.push({
      ruleId: "typescript/explicit-conditional-jsx-callback",
      line: lineAt(source, match.index ?? 0),
      message:
        `Parameter '${parameter}' in conditional JSX callback '${prop}' needs an explicit type. ` +
        "Prefer a named callback typed from the component prop contract (for example, " +
        "`NonNullable<Props['onChange']>`) so API changes are checked at the boundary.",
    });
  }
  return findings;
}

// ── YAML structural check (dependency-free stand-in for exact YAML parsing) ──

/** Tabs are illegal in YAML indentation; mixed/none are the common agent mistakes. */
const YAML_TAB_INDENT = /^\t+ /m;
/** Unbalanced flow brackets almost always mean a truncated or malformed document. */
function yamlFlowUnbalanced(content: string): boolean {
  let depth = 0;
  for (const ch of content) {
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0;
}

function checkYamlContent(content: string): string | null {
  if (YAML_TAB_INDENT.test(content)) {
    return "YAML uses tab characters for indentation, which YAML forbids — use spaces.";
  }
  if (yamlFlowUnbalanced(content)) {
    return "YAML flow collection brackets ([ ] { }) are unbalanced — the document is malformed.";
  }
  return null;
}

// ── The per-file policy ──────────────────────────────────────────────────────

/** One file's content against its policy: `skipped` when none applies. Never throws. */
export function checkFileContent(
  path: string,
  content: string,
): { kind: "checked" | "skipped" } | { kind: "errors"; errors: Array<Omit<VerifyError, "path">> } {
  if (!isVerifiablePath(path)) return { kind: "skipped" };
  try {
    if (JSON_EXT.test(path)) {
      JSON.parse(content);
    } else if (YAML_EXT.test(path)) {
      const yamlError = checkYamlContent(content);
      if (yamlError) return { kind: "errors", errors: [{ message: yamlError.slice(0, 240) }] };
    } else {
      const findings = inspectAgentSource(path, content);
      if (findings.length) {
        return { kind: "errors", errors: findings.map((f) => ({ message: f.message, line: f.line, ruleId: f.ruleId })) };
      }
    }
    return { kind: "checked" };
  } catch (e) {
    return { kind: "errors", errors: [{ message: (e as Error).message.slice(0, 240) }] };
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
    if (o.kind === "errors") errors.push(...o.errors.map((error) => ({ path: o.path, ...error })));
    else if (o.kind === "checked") checked.push(o.path);
    else skipped.push(o.path);
  }
  return { ok: errors.length === 0, checked, skipped, errors };
}

/**
 * Verify a set of paths by reading each through the caller's `read` port, applying the
 * per-file policy. A path that cannot be read or whose content is unavailable is
 * `skipped`, never false-failed. Best-effort: never throws.
 */
export async function verifyWrittenFiles(
  read: (path: string) => Promise<string | null>,
  paths: Iterable<string>,
): Promise<VerifyResult> {
  const list = [...paths];
  const outcomes = await Promise.all(
    list.map(async (path) => {
      if (!isVerifiablePath(path)) return { path, kind: "skipped" as const };
      const content = await read(path).catch(() => null);
      if (content === null) return { path, kind: "skipped" as const };
      return { path, ...checkFileContent(path, content) };
    }),
  );
  return foldVerifyOutcomes(outcomes);
}
