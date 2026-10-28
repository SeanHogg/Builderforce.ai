/**
 * Which deterministic tools a workspace HAS — the PreFetch registry offers a row only when
 * its tool is detected (docs/design/deterministic-prefetch.md: "a tool that isn't
 * installed in the workspace isn't offered"). Detection reads the workspace's
 * `package.json` (dependencies and devDependencies), its lockfiles and the PATH, through
 * a {@link ToolProbe} the host supplies; the host memoises the result per workspace.
 *
 * A GROUP id (`linter`, `formatter`, …) is present when any of its tools is, and points
 * at the first one in preference order — a row that any of ESLint, Biome or Ruff can
 * answer requires `linter`, and its executor reads which one it got.
 *
 * Pure: no fs, no process. The Node probe is `@builderforce/agent-tools/node-prefetch`.
 */

import type { DetectedTool, DetectedTools } from './contract.js';

interface ToolSpec {
    /** npm packages that provide it (any one, in `dependencies` or `devDependencies`). */
    packages?: readonly string[];
    /** Its executable name. */
    bin: string;
}

/** Every tool a shared row can run, by id. */
export const PREFETCH_TOOLS: Readonly<Record<string, ToolSpec>> = {
    eslint: { packages: ['eslint'], bin: 'eslint' },
    biome: { packages: ['@biomejs/biome'], bin: 'biome' },
    ruff: { bin: 'ruff' },
    prettier: { packages: ['prettier'], bin: 'prettier' },
    black: { bin: 'black' },
    'dependency-cruiser': { packages: ['dependency-cruiser'], bin: 'depcruise' },
    madge: { packages: ['madge'], bin: 'madge' },
    jscpd: { packages: ['jscpd'], bin: 'jscpd' },
    knip: { packages: ['knip'], bin: 'knip' },
    'osv-scanner': { bin: 'osv-scanner' },
    gitleaks: { bin: 'gitleaks' },
    vitest: { packages: ['vitest'], bin: 'vitest' },
    plop: { packages: ['plop'], bin: 'plop' },
    hygen: { packages: ['hygen'], bin: 'hygen' },
    'ast-grep': { packages: ['@ast-grep/cli'], bin: 'ast-grep' },
    orval: { packages: ['orval'], bin: 'orval' },
    'openapi-generator': { packages: ['@openapitools/openapi-generator-cli'], bin: 'openapi-generator-cli' },
    prisma: { packages: ['prisma'], bin: 'prisma' },
    'graphql-codegen': { packages: ['@graphql-codegen/cli'], bin: 'graphql-codegen' },
    typescript: { packages: ['typescript'], bin: 'tsc' },
};

/** `npm audit` (or the lockfile's own manager) — present whenever a lockfile is. */
export const AUDIT_TOOL = 'npm-audit';

/** Lockfiles, in preference order, and the audit command each one answers to. */
const LOCKFILES: ReadonlyArray<{ file: string; command: string }> = [
    { file: 'package-lock.json', command: 'npm audit' },
    { file: 'npm-shrinkwrap.json', command: 'npm audit' },
    { file: 'pnpm-lock.yaml', command: 'pnpm audit' },
];

/** Groups: the first present tool, in this order, stands for the group. */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
    linter: ['eslint', 'biome', 'ruff'],
    formatter: ['prettier', 'biome', 'black'],
    'dependency-audit': ['osv-scanner', AUDIT_TOOL],
    'openapi-codegen': ['orval', 'openapi-generator'],
};

/** What detection reads the workspace through. Paths are workspace-root-relative. */
export interface ToolProbe {
    /** A file's text, or undefined when it is absent or unreadable. */
    readText(path: string): Promise<string | undefined>;
    exists(path: string): Promise<boolean>;
    /** Whether an executable of this name is on the PATH. */
    onPath(bin: string): Promise<boolean>;
}

/** The packages `package.json` declares (dependencies + devDependencies). */
export function declaredPackages(manifestText: string | undefined): Set<string> {
    if (!manifestText) return new Set();
    try {
        const m = JSON.parse(manifestText) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
        return new Set([...Object.keys(m.dependencies ?? {}), ...Object.keys(m.devDependencies ?? {})]);
    } catch {
        return new Set();
    }
}

/** A workspace dependency runs through npm without installing anything (`--no`): the workspace's own copy or nothing. */
const viaDependency = (bin: string): string => `npm exec --no -- ${bin}`;

export async function detectTools(probe: ToolProbe): Promise<DetectedTools> {
    const declared = declaredPackages(await probe.readText('package.json'));
    const found = new Map<string, DetectedTool>();
    await Promise.all(Object.entries(PREFETCH_TOOLS).map(async ([id, spec]) => {
        // Declared, or installed in the workspace's own `node_modules/.bin` (a monorepo hoists
        // a tool its root manifest does not name): the workspace's copy runs.
        if (spec.packages?.some((p) => declared.has(p)) || (spec.packages && await probe.exists(`node_modules/.bin/${spec.bin}`).catch(() => false))) {
            found.set(id, { id, via: 'dependency', command: viaDependency(spec.bin) });
        } else if (await probe.onPath(spec.bin).catch(() => false)) {
            found.set(id, { id, via: 'path', command: spec.bin });
        }
    }));
    for (const lock of LOCKFILES) {
        if (await probe.exists(lock.file).catch(() => false)) {
            found.set(AUDIT_TOOL, { id: AUDIT_TOOL, via: 'lockfile', command: lock.command });
            break;
        }
    }
    for (const [group, members] of Object.entries(TOOL_GROUPS)) {
        const first = members.map((m) => found.get(m)).find((t): t is DetectedTool => !!t);
        if (first) found.set(group, first);
    }
    // Insertion order is the catalog's, not the probes' finishing order: equal input, equal map.
    const order = [...Object.keys(PREFETCH_TOOLS), AUDIT_TOOL, ...Object.keys(TOOL_GROUPS)];
    return new Map(order.flatMap((id) => (found.has(id) ? [[id, found.get(id)!] as const] : [])));
}

/** The tool ids the gate offers rows for (`GatePorts.tools`): the detected ones, plus the host's own templates. */
export function offeredToolIds(detected: DetectedTools | undefined, extras: readonly string[] = []): ReadonlySet<string> {
    return new Set([...(detected?.keys() ?? []), ...extras]);
}
