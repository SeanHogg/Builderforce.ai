/**
 * The SHARED PreFetch registry rows (docs/design/deterministic-prefetch.md, "Initial
 * action registry") — data, one row per deterministic action that runs wherever the
 * workspace and a shell are (the editor and on-prem). A row is offered only when the tool
 * it `requires` was detected (`tools.ts`); a WRITE row is always confirmed first.
 *
 * Labels are `prefetch.action.<id>` in every host's catalog.
 */

import { TEMPLATES_TOOL, type PrefetchRow } from './contract.js';

const WHERE: PrefetchRow['surfaces'] = ['vscode', 'onprem'];
/** The code pack's analyzers run three tools over the workspace: minutes on a large tree. */
const CODE_PACK_BUDGET_MS = 120_000;
/** A prefetch is a turn's preamble: what it misses, the model looks up itself. */
const PREFETCH_BUDGET_MS = 20_000;
/** A confirmed write may take a while; the person asked for it. */
const WRITE_BUDGET_MS = 120_000;

const label = (id: string): string => `prefetch.action.${id}`;
const row = (r: Omit<PrefetchRow, 'surfaces' | 'labelKey'>): PrefetchRow => ({ ...r, surfaces: WHERE, labelKey: label(r.id) });

/** `diag.typecheck`'s id — the editor overrides its executor with LSP diagnostics first. */
export const DIAG_TYPECHECK = 'diag.typecheck';

export const SHARED_PREFETCH_ROWS: readonly PrefetchRow[] = [
    row({
        id: DIAG_TYPECHECK, kind: 'prefetch', sideEffect: 'read', slash: '/typecheck',
        patterns: [/\b(type[- ]?errors?|typecheck|type-check|tsc errors?)\b/i],
        examples: ['fix the type errors', 'why does this not compile', 'what are the TypeScript errors in this file', 'make the build pass'],
        budgetMs: PREFETCH_BUDGET_MS,
    }),
    row({
        id: 'lint.check', kind: 'prefetch', sideEffect: 'read', slash: '/lint',
        patterns: [/\blint(er|ing)? (errors?|warnings?|issues?|problems?)\b/i],
        examples: ['fix the lint errors', 'what does eslint complain about', 'clean up the linter warnings'],
        budgetMs: PREFETCH_BUDGET_MS, requires: { tool: 'linter' },
    }),
    row({
        id: 'lint.fix', kind: 'answer', sideEffect: 'write', slash: '/lint-fix',
        patterns: [/^\s*(run\s+)?(eslint|biome lint|ruff check)\b.*--?(fix|write)\b/i, /\bauto-?fix (the )?lint(ing)? (errors?|warnings?|issues?)\b/i],
        examples: ['auto-fix the lint errors', 'run eslint --fix', 'apply the linter fixes'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'linter' },
    }),
    row({
        id: 'dup.check', kind: 'answer', sideEffect: 'read', slash: '/dup',
        patterns: [/\b(find|show|list|any|where is)( the| me)? (duplicate[ds]?|copy-?pasted?|cloned?) (code|logic|blocks?)\b/i],
        examples: ['find duplicate code', 'where is code copy-pasted', 'show me the clones', 'is there duplicated logic'],
        budgetMs: CODE_PACK_BUDGET_MS, requires: { tool: 'jscpd' },
    }),
    row({
        id: 'deps.cycles', kind: 'answer', sideEffect: 'read', slash: '/cycles',
        patterns: [/\b(circular|cyclic) (imports?|dependenc(y|ies))\b/i, /\bimport cycles?\b/i],
        examples: ['find circular imports', 'are there dependency cycles', 'which modules import each other'],
        budgetMs: CODE_PACK_BUDGET_MS, requires: { tool: 'dependency-cruiser' },
    }),
    row({
        id: 'deadcode.check', kind: 'answer', sideEffect: 'read', slash: '/deadcode',
        patterns: [/\b(find|show|list|any)( the| me)? (dead|unused) (code|exports?|files?|dependencies)\b/i],
        examples: ['find dead code', 'list the unused exports', 'which files are never imported', 'unused dependencies'],
        budgetMs: CODE_PACK_BUDGET_MS, requires: { tool: 'knip' },
    }),
    row({
        id: 'arch.boundaries', kind: 'prefetch', sideEffect: 'read', slash: '/boundaries',
        patterns: [/\b(layer|layering|architecture|boundary|boundaries) (violations?|rules?|breaches?)\b/i],
        examples: ['does this respect the layers', 'check the architecture boundaries', 'is the domain importing infrastructure'],
        budgetMs: PREFETCH_BUDGET_MS, requires: { tool: 'dependency-cruiser' },
    }),
    row({
        id: 'deps.audit', kind: 'answer', sideEffect: 'read', slash: '/audit',
        patterns: [/\b(vulnerable|vulnerabilit(y|ies)) (dependenc(y|ies)|packages?)\b/i, /\b(npm|pnpm|dependency|security) audit\b/i, /\bknown cves?\b/i],
        examples: ['audit the dependencies', 'are any packages vulnerable', 'run npm audit', 'which dependencies have CVEs'],
        budgetMs: 60_000, requires: { tool: 'dependency-audit' },
    }),
    row({
        id: 'secrets.scan', kind: 'answer', sideEffect: 'read', slash: '/secrets',
        patterns: [/\b(leaked|hard-?coded|committed|exposed) (secrets?|credentials?|api keys?|tokens?|passwords?)\b/i, /\bscan (for|the repo for) secrets\b/i],
        examples: ['scan for leaked secrets', 'are there hardcoded API keys', 'did we commit any credentials'],
        budgetMs: 60_000, requires: { tool: 'gitleaks' },
    }),
    row({
        id: 'tests.related', kind: 'prefetch', sideEffect: 'read', slash: '/related',
        patterns: [/\b(related|affected) tests?\b/i, /\bwhich tests (cover|touch|exercise)\b/i],
        examples: ['which tests cover this change', 'run the related tests', 'what tests does this affect'],
        budgetMs: 30_000, requires: { tool: 'vitest' },
    }),
    row({
        id: 'scaffold.plop', kind: 'answer', sideEffect: 'write', slash: '/plop',
        patterns: [/^\s*plop\s+[\w-]+/i],
        examples: ['scaffold a new component with plop', 'generate a component from the plop generator'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'plop' },
    }),
    row({
        id: 'scaffold.hygen', kind: 'answer', sideEffect: 'write', slash: '/hygen',
        patterns: [/^\s*hygen\s+[\w-]+\s+[\w-]+/i],
        examples: ['generate a module with hygen', 'run the hygen generator'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'hygen' },
    }),
    row({
        id: 'scaffold.template', kind: 'answer', sideEffect: 'write', slash: '/scaffold',
        examples: ['scaffold the starter app', 'create the vanilla starter project', 'set up the mobile starter'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: TEMPLATES_TOOL },
    }),
    row({
        id: 'codegen.openapi', kind: 'answer', sideEffect: 'write', slash: '/codegen-openapi',
        patterns: [/\b(re)?generate (the )?(openapi|rest api|api) (client|types|sdk)\b/i, /^\s*(orval|openapi-generator-cli generate)\b/i],
        examples: ['regenerate the API client from the OpenAPI spec', 'run orval'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'openapi-codegen' },
    }),
    row({
        id: 'codegen.prisma', kind: 'answer', sideEffect: 'write', slash: '/prisma-generate',
        patterns: [/\bprisma generate\b/i, /\b(re)?generate (the )?prisma client\b/i],
        examples: ['regenerate the prisma client', 'run prisma generate'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'prisma' },
    }),
    row({
        id: 'codegen.graphql', kind: 'answer', sideEffect: 'write', slash: '/codegen-graphql',
        patterns: [/\bgraphql-codegen\b/i, /\b(re)?generate (the )?graphql (types|hooks|client|schema types)\b/i],
        examples: ['regenerate the GraphQL types', 'run graphql-codegen'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'graphql-codegen' },
    }),
    row({
        id: 'codemod.pattern', kind: 'answer', sideEffect: 'write', slash: '/codemod',
        patterns: [/^\s*(ast-grep|sg)\s+(run|scan)\b/i],
        examples: ['rewrite every console.log($A) to logger.info($A)', 'codemod oldApi($X) => newApi($X)'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'ast-grep' },
    }),
    row({
        id: 'format.apply', kind: 'answer', sideEffect: 'write', slash: '/format',
        patterns: [/\b(format|prettify|reformat) (the |this |all )?(code|files?|project|repo|workspace)\b/i, /^\s*run (prettier|black|biome format)\b/i],
        examples: ['format the code', 'run prettier on the project', 'reformat these files'],
        budgetMs: WRITE_BUDGET_MS, requires: { tool: 'formatter' },
    }),
];
