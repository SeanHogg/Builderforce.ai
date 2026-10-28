/**
 * The editor's PreFetch REGISTRY and EXECUTORS (docs/design/deterministic-prefetch.md) —
 * split from `vscodePrefetchPort.ts`, which only assembles the port:
 *
 *   - the editor's own rows: `symbols.where-defined` (`whereDefinedAnswer`, the symbol
 *     index) and `context.pre-search` (the context pack's own `preSearchOnce`, the SAME
 *     memoized computation the pack and the participant read, so it never runs twice);
 *     `memory.answer` is a row only — memory stays in `runMemory.answerFromMemory`;
 *   - `knowledge.ask` (`knowledgeAskRow.ts`): the workspace's knowledge index, answering
 *     or — below its learned threshold — riding into the turn as PREFETCH context;
 *   - the SHARED rows and executors (`@builderforce/agent-tools/prefetch` — lint, typecheck,
 *     the code pack's duplicates/cycles/dead code, boundaries, audit, secrets, related
 *     tests, scaffolds, codegen, codemods, formatting), run through the editor's ONE local
 *     capability provider (its shell and repo), exactly as on-prem runs them;
 *   - `diag.typecheck` asks the language servers first (`lspDiagnostics.ts`, injected) and
 *     falls back to the shared `tsc --noEmit` only when no diagnostics are available.
 *
 * No `vscode` import: the editor-only parts are handed in.
 */

import { WHERE_DEFINED_LEAD, type CapabilityProvider } from "@builderforce/agent-tools";
import {
  DIAG_TYPECHECK,
  SHARED_PREFETCH_ROWS,
  fenced,
  sharedPrefetchExecutors,
  type DetectedTools,
  type PrefetchExecHost,
  type ScaffoldTemplates,
} from "@builderforce/agent-tools/prefetch";
import { defineRegistry, type PrefetchAction, type PrefetchExecutors } from "@builderforce/prefetch";
import { CONTEXT_PACK_DEADLINE_MS } from "../contextPack/deadline";
import { preSearchOnce, whereDefinedOnce } from "../contextPack/preSearchSource";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { knowledgeRootId } from "../knowledge/knowledgeRoots";
import { KNOWLEDGE_ASK_ROWS, knowledgeAskExecutors } from "./knowledgeAskRow";

/** The most diagnostic lines `diag.typecheck` carries into a turn. */
export const PREFETCH_LIST_CAP_LINES = 200;

/** What the language servers reported: `available` false ⇒ none has the focus files open. */
export type LspDiagnostics = (root: string) => Promise<{ available: boolean; lines: string[]; files?: number }>;

/** The editor's own rows, ahead of the shared ones. Labels are `prefetch.action.<id>` (`prefetchLabels.ts`). */
const EDITOR_ROWS: PrefetchAction[] = [
  {
    id: "symbols.where-defined",
    kind: "answer",
    sideEffect: "read",
    surfaces: ["vscode", "onprem"],
    patterns: [WHERE_DEFINED_LEAD],
    examples: ["where is fooBar defined", "which file defines Widget", "find the definition of parseConfig", "where are the routes declared"],
    budgetMs: CONTEXT_PACK_DEADLINE_MS,
    labelKey: "prefetch.action.symbols.where-defined",
  },
  {
    id: "context.pre-search",
    kind: "prefetch",
    sideEffect: "read",
    surfaces: ["vscode", "onprem", "cloud", "web"],
    examples: ["fix the bug in parseConfig", "how does resolveMembership work", "what calls createRunHost", "update the Widget component"],
    budgetMs: CONTEXT_PACK_DEADLINE_MS,
    labelKey: "prefetch.action.context.pre-search",
  },
  {
    id: "memory.answer",
    kind: "answer",
    sideEffect: "read",
    surfaces: ["vscode", "onprem", "cloud", "web"],
    examples: ["what did we decide about the billing schema", "remind me how deploys work here", "what was the answer last time"],
    budgetMs: CONTEXT_PACK_DEADLINE_MS,
    labelKey: "prefetch.action.memory.answer",
  },
];

/** The editor's rows, `knowledge.ask`, then the shared ones — one registry, validated once. */
export const VSCODE_PREFETCH_REGISTRY: readonly PrefetchAction[] = defineRegistry([...EDITOR_ROWS, ...KNOWLEDGE_ASK_ROWS, ...SHARED_PREFETCH_ROWS]);

/** The knowledge-graph root id of a workspace folder (`knowledge/knowledgeRoots.ts`) — what the Open-in-graph chip's refs name. */
export { knowledgeRootId };

export interface EditorExecutorOptions {
  /** The workspace root, read per call. */
  root: () => string;
  /** The person's own words when the user turn also inlines references. */
  ownWords?: string;
  /** Detected tools (memoised by `detectTools.ts`). */
  tools: () => DetectedTools | undefined;
  /** Root-relative files the person is working in. */
  focusFiles?: () => readonly string[];
  /** The language servers' diagnostics (`lspDiagnostics.ts`); absent ⇒ `tsc` only. */
  diagnostics?: LspDiagnostics;
  /** Starter scaffolds (`@builderforce/ide-templates`). */
  templates?: ScaffoldTemplates;
  /** The capability provider per root; default the editor's local one (`localCapabilities.ts`). */
  caps?: (root: string) => CapabilityProvider;
}

/** One local provider per root, kept for the port's life (it holds no run state). */
function capsCache(build: (root: string) => CapabilityProvider): (root: string) => CapabilityProvider {
  const byRoot = new Map<string, CapabilityProvider>();
  return (root) => {
    let caps = byRoot.get(root);
    if (!caps) byRoot.set(root, (caps = build(root)));
    return caps;
  };
}

/** The shared executors' view of this editor: read per call, so a changed folder is followed. */
function execHost(options: EditorExecutorOptions): PrefetchExecHost {
  const capsFor = capsCache(options.caps ?? ((root) => buildLocalCapabilityProvider(root)));
  return {
    get caps() {
      return capsFor(options.root());
    },
    tools: options.tools,
    get rootId() {
      return knowledgeRootId(options.root());
    },
    ...(options.focusFiles ? { focusFiles: options.focusFiles } : {}),
    ...(options.templates ? { templates: options.templates } : {}),
  };
}

export function editorPrefetchExecutors(options: EditorExecutorOptions): PrefetchExecutors {
  const { root, ownWords } = options;
  const shared = sharedPrefetchExecutors(execHost(options));
  const tsc = shared[DIAG_TYPECHECK]!;
  return {
    ...shared,
    ...knowledgeAskExecutors(root, ownWords),
    "symbols.where-defined": {
      run: async (request) => {
        const text = await whereDefinedOnce(root(), ownWords ?? request, CONTEXT_PACK_DEADLINE_MS);
        return text ? { actionId: "symbols.where-defined", text } : undefined;
      },
    },
    "context.pre-search": {
      run: async (request, signal) => {
        const text = await preSearchOnce(root(), ownWords ?? request, CONTEXT_PACK_DEADLINE_MS, { signal });
        return text ? { actionId: "context.pre-search", text } : undefined;
      },
    },
    [DIAG_TYPECHECK]: {
      run: async (request, signal) => {
        const lsp = await options.diagnostics?.(root()).catch(() => undefined);
        if (!lsp?.available) return tsc.run(request, signal);
        const where = `${lsp.files ?? 0} open file(s)`;
        const text = lsp.lines.length === 0
          ? `Language servers: no errors or warnings in the ${where}.`
          : fenced(`Language servers: ${lsp.lines.length} problem(s) in the ${where}`, lsp.lines.join("\n"));
        return { actionId: DIAG_TYPECHECK, text, data: { source: "lsp", problems: lsp.lines.length } };
      },
    },
  };
}
