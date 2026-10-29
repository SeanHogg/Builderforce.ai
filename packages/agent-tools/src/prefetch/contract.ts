/**
 * The SHARED PreFetch executors' contract (docs/design/deterministic-prefetch.md) — the
 * deterministic actions every surface with a workspace and a shell runs the same way:
 * the editor (VSIX) and on-prem (agent-runtime). A surface-only executor (the editor's
 * LSP diagnostics) stays with its surface.
 *
 * STRUCTURAL ON PURPOSE. These shapes are `@builderforce/prefetch`'s `PrefetchAction`,
 * `PrefetchResult` and `PrefetchExecutor`, restated: agent-tools may not import that
 * package, because every project that resolves agent-tools (the api, the frontend, the
 * Worker packages, …) would then have to resolve it too (the source-package graph's
 * "stated edges are closed" rule). The hosts that do import it hand these rows and
 * executors straight to `defineRegistry` / `PrefetchPort`, so a drift fails their type
 * check, not a run.
 */

import type { CapabilityProvider } from '../capabilities.js';
import type { RepoGraphPort } from '../knowledge/workspaceAnalysis.js';

/** A registry row (`PrefetchAction`). */
export interface PrefetchRow {
    id: string;
    kind: 'answer' | 'prefetch';
    sideEffect: 'read' | 'write';
    surfaces: Array<'vscode' | 'onprem' | 'cloud' | 'web'>;
    slash?: string;
    patterns?: RegExp[];
    examples: string[];
    budgetMs: number;
    requires?: { tool: string };
    labelKey: string;
}

/** A chip under an adopted answer (`PrefetchResult.chips`). */
export interface PrefetchChip {
    labelKey: string;
    command: string;
    args?: Record<string, unknown>;
}

/** What an executor returns (`PrefetchResult`). */
export interface PrefetchOutput {
    actionId: string;
    text: string;
    chips?: PrefetchChip[];
    data?: Record<string, unknown>;
    /** ANSWER only: the executor's own evidence (0–1); below the action's learned threshold the gate keeps it as PREFETCH context. */
    confidence?: number;
    /** What rides into the turn when the gate demotes this answer; default `text`. */
    context?: string;
}

/** One executor (`PrefetchExecutor`). */
export interface PrefetchRunner {
    run(request: string, signal: AbortSignal): Promise<PrefetchOutput | undefined>;
    /** WRITE rows: the confirm chip's detail line (`PrefetchExecutor.preview`). */
    preview?(request: string, signal: AbortSignal): Promise<string | undefined>;
}

/** How a detected tool is invoked: a workspace dependency, a binary on the PATH, or a lockfile's package manager. */
export interface DetectedTool {
    /** The concrete tool (`eslint`, `osv-scanner`, …) — for a group id (`linter`) the one chosen. */
    id: string;
    via: 'dependency' | 'path' | 'lockfile';
    /** The command prefix the tool runs as (`npm exec --no -- eslint`, `ruff`, `npm audit`). */
    command: string;
}

/** Tools detected in one workspace, by tool id and by group id (`linter`, `formatter`, …). */
export type DetectedTools = ReadonlyMap<string, DetectedTool>;

/** Starter scaffolds by name (`@builderforce/ide-templates`' `TEMPLATES`), handed in by the host. */
export type ScaffoldTemplates = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** What the shared executors run through — the surface's own seams, never a process of their own. */
export interface PrefetchExecHost {
    /** The surface's capability provider: `shell` runs every tool, `repoRead`/`repoWrite` read reports and write rule files. */
    caps: CapabilityProvider;
    /** The tools detected in this workspace, read per call (memoised by the host). */
    tools(): DetectedTools | undefined;
    /** The knowledge graph's root id for this workspace — what the Open-in-graph chip's refs name. */
    rootId: string;
    /** Root-relative files the person is working in (open or touched) — scopes lint, typecheck and related tests. */
    focusFiles?(): readonly string[];
    /** The repo map (`@builderforce/repo-map`'s `repoMapPort`): its `references` edges ride the code-pack analysis. Absent ⇒ none. */
    repoGraph?: RepoGraphPort;
    /** Starter scaffolds; absent ⇒ `scaffold.template` is not offered. */
    templates?: ScaffoldTemplates;
}

/** The pseudo-tool `scaffold.template` requires — present when the host hands templates in. */
export const TEMPLATES_TOOL = 'ide-templates';
