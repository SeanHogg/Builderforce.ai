/**
 * Governance gates in the IDE — the VS Code mirror of the compile primitive's policy
 * modality (`packages/agent-tools/src/spec.ts`). The extension cannot import the
 * shared package (it bundles for the VS Code Node host, not the Worker/web target),
 * so this is a deliberately tiny, self-contained copy of the gate shape + the two
 * pure decisions the engine needs. Kept in lock-step with the shared
 * `PolicyGate`/`evaluatePolicyGate`/`renderPolicyDirectives` by contract.
 *
 * Because the gate is enforced HERE (at the IDE loop's tool seam) exactly as the
 * cloud loop enforces it, "a governance gate applies in the IDE exactly as in the
 * cloud" is literally true — the same compiled gate, the same block/approve decision.
 */

export interface PolicyGate {
  id: string;
  /** Tool this gate governs; omit (or "*") to govern every tool call. */
  tool?: string;
  /**
   * Optional path globs / directory prefixes this gate is scoped to. A path-scoped
   * gate matches only when the tool call's path hits one of these. Omit to govern
   * the tool regardless of path.
   */
  paths?: string[];
  effect: "inject-directive" | "require-approval" | "block";
  directive?: string;
  reason?: string;
}

export type PolicyDecision =
  | { action: "allow" }
  | { action: "require-approval"; gateId: string; reason: string }
  | { action: "block"; gateId: string; reason: string };

/**
 * Paths a tool call is acting on, extracted from the common arg shapes (`path`,
 * `filePath`, `oldPath`, `newPath`, `paths[]`). Mirrors the shared `toolCallPaths`.
 */
export function toolCallPaths(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  };
  add(args.path);
  add(args.filePath);
  add(args.oldPath);
  add(args.newPath);
  if (Array.isArray(args.paths)) {
    for (const p of args.paths) add(p);
  }
  return out;
}

/** Regex metacharacters (other than glob operators) that must be escaped. */
const REGEX_SPECIALS = new Set([".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\", "/"]);

/** Compile a glob to an anchored, case-insensitive RegExp. Mirrors agent-tools `globToRegExp`. */
function globToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i++;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += REGEX_SPECIALS.has(c) ? "\\" + c : c;
    }
  }
  return new RegExp("^" + re + "$", "i");
}

function matchGlob(pathPosix: string, pattern: string): boolean {
  const re = globToRegExp(pattern);
  if (!pattern.includes("/")) {
    const base = pathPosix.slice(pathPosix.lastIndexOf("/") + 1);
    return re.test(base);
  }
  return re.test(pathPosix);
}

function normalizeScopePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

function inScope(path: string, scope: readonly string[]): boolean {
  const p = normalizeScopePath(path);
  return scope.some((entry) => {
    const s = normalizeScopePath(entry);
    return s === "" || p === s || p.startsWith(`${s}/`);
  });
}

function pathHitsPattern(path: string, pattern: string): boolean {
  return matchGlob(path, pattern) || inScope(path, [pattern]);
}

function gateMatchesPath(g: PolicyGate, callPath?: string | readonly string[]): boolean {
  const patterns = g.paths;
  if (!patterns || patterns.length === 0) return true;
  const callPaths = (Array.isArray(callPath) ? callPath : callPath ? [callPath] : [])
    .map((p) => p.trim())
    .filter(Boolean);
  // Path-scoped but the seam did not pass a path: do not match. Existing call
  // sites that only pass toolName keep today's tool-only behaviour.
  if (callPaths.length === 0) return false;
  return callPaths.some((p) => patterns.some((pat) => pathHitsPattern(p, pat)));
}

/** Decide what the engine must do for a pending tool call (block > approval > allow). */
export function evaluatePolicyGate(
  gates: readonly PolicyGate[] | undefined,
  toolName: string,
  path?: string | readonly string[],
): PolicyDecision {
  const matches = (gates ?? []).filter(
    (g) => (!g.tool || g.tool === "*" || g.tool === toolName) && gateMatchesPath(g, path),
  );
  const blocked = matches.find((g) => g.effect === "block");
  if (blocked) return { action: "block", gateId: blocked.id, reason: blocked.reason ?? "blocked by policy" };
  const approval = matches.find((g) => g.effect === "require-approval");
  if (approval) {
    return { action: "require-approval", gateId: approval.id, reason: approval.reason ?? "approval required by policy" };
  }
  return { action: "allow" };
}

/** Render gates as binding system-prompt lines (mirrors `renderPolicyDirectives`). */
export function renderPolicyDirectives(gates: readonly PolicyGate[] | undefined): string {
  const lines = (gates ?? [])
    .map((g) => {
      const scope = !g.tool || g.tool === "*" ? "any tool" : `the \`${g.tool}\` tool`;
      const pathScope = g.paths?.length ? ` on ${g.paths.map((p) => `\`${p}\``).join(", ")}` : "";
      if (g.effect === "inject-directive") return (g.directive ?? "").trim();
      if (g.effect === "require-approval") {
        return `Before using ${scope}${pathScope}, pause and request explicit human approval${g.reason ? ` (${g.reason})` : ""}.`;
      }
      return `Never use ${scope}${pathScope}${g.reason ? ` — ${g.reason}` : ""}. Refuse and explain instead.`;
    })
    .filter(Boolean);
  if (lines.length === 0) return "";
  return ["Governance (these gates are binding):", ...lines.map((g) => `- ${g}`)].join("\n");
}
