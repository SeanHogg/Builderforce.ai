/**
 * `knowledge.ask` (PRD 38 §4.9; docs/design/deterministic-knowledge-index.md, "Consumers")
 * — questions about a reviewed root, answered from its knowledge index plus one hop of
 * graph expansion: "where is billing handled", "which file owns webhooks", "what does the
 * lease say about termination", "where do we retry".
 *
 * ONE row and ONE executor for every host: the editor and on-prem hand in their local
 * index, a browser host (web, Rovr) its remote `searchRecall` — the same answer format. The executor never decides answer-versus-prefetch itself: it
 * returns the answer with its own evidence as `confidence` (1 on an exact key hit, else
 * the fused top hit's strength — `hitConfidence`) and the same hits as `context`. The GATE
 * (`runGate`) settles on it only when that clears the action's learned answer threshold;
 * otherwise the context rides into the turn as PREFETCH.
 */

import { pathOfRef } from '@seanhogg/builderforce-memory/knowledge';
import { CHIP_FOCUS_MAX, openInGraphChip } from '../../prefetch/graphChip.js';
import { rootIdOfSourceRef } from '../rootId.js';
import type { PrefetchOutput, PrefetchRow, PrefetchRunner } from '../../prefetch/contract.js';
import type { HostKnowledgeIndexCore } from './contract.js';
import { hitConfidence, renderKnowledgeAnswer, renderKnowledgeContext, shownHits } from './renderHits.js';

export const KNOWLEDGE_ASK = 'knowledge.ask';
/** The pre-turn budget every read-only answer row shares (the context pack's deadline). */
export const KNOWLEDGE_ASK_BUDGET_MS = 1_500;

/** The question shapes — each captures what is asked about (and, for a document, which one). */
const SUBJECT_PATTERNS: ReadonlyArray<{ re: RegExp; subject: (m: RegExpMatchArray) => string }> = [
    { re: /\bwhat does (?:the )?(.+?) say about (.+?)\s*\??$/i, subject: (m) => `${m[1]} ${m[2]}` },
    { re: /\bwhere (?:is|are|does|do we|do i) (.+?) (?:get |gets )?(?:handled|implemented|processed|managed|configured|wired(?: up)?|set up|computed|validated|stored|parsed|routed|owned|tested)\b/i, subject: (m) => m[1]! },
    { re: /\bwhich (?:files?|modules?|packages?|areas?|folders?|director(?:y|ies)|layers?|services?|components?|classes) (?:owns?|handles?|implements?|manages?|deals with|is responsible for|are responsible for|contains?|covers?) (.+?)\s*\??$/i, subject: (m) => m[1]! },
    { re: /\bwhich specs? (?:mention|cover|talk about|describe)s? (.+?)\s*\??$/i, subject: (m) => m[1]! },
    { re: /\bwhich layer (?:is|are) (.+?) in\s*\??$/i, subject: (m) => m[1]! },
    { re: /\bwhat(?:'s| is) similar to (.+?)\s*\??$/i, subject: (m) => m[1]! },
    { re: /\bwhere do we (.+?)\s*\??$/i, subject: (m) => m[1]! },
];

/** What a request asks the index about; undefined when it is not a knowledge question. */
export function knowledgeSubject(request: string): string | undefined {
    for (const { re, subject } of SUBJECT_PATTERNS) {
        const m = request.match(re);
        if (!m) continue;
        const s = subject(m).replace(/[`"'“”‘’]/g, '').replace(/^(?:the|a|an|our)\s+/i, '').trim();
        if (s) return s;
    }
    return undefined;
}

export const KNOWLEDGE_ASK_ROW: PrefetchRow = {
    id: KNOWLEDGE_ASK,
    kind: 'answer',
    sideEffect: 'read',
    surfaces: ['vscode', 'onprem', 'cloud', 'web'],
    slash: '/ask',
    patterns: SUBJECT_PATTERNS.map((p) => p.re),
    examples: [
        'where is billing handled',
        'which file owns the webhooks',
        'what does the lease say about termination',
        'where do we retry failed requests',
        'which specs mention SSO',
        'which layer is retryPolicy in',
    ],
    budgetMs: KNOWLEDGE_ASK_BUDGET_MS,
    labelKey: `prefetch.action.${KNOWLEDGE_ASK}`,
};

export interface KnowledgeAskHost {
    /** The index of the root the request is about (the workspace's; a browser's remote
     *  `searchRecall`); undefined ⇒ nothing to ask. Only its `recall` is read. */
    index(): Promise<Pick<HostKnowledgeIndexCore, 'recall'> | undefined>;
    /** Hits to show (default 8). */
    max?: number;
}

/** The text after a `/ask` slash, else the subject the question names, else the request itself. */
function queryOf(request: string): string {
    const slash = request.match(/^\s*\/ask\s+([\s\S]+)$/i);
    if (slash) return slash[1]!.trim();
    return knowledgeSubject(request) ?? request.trim();
}

export function knowledgeAskExecutor(host: KnowledgeAskHost): PrefetchRunner {
    return {
        async run(request, signal): Promise<PrefetchOutput | undefined> {
            const query = queryOf(request);
            if (!query || signal.aborted) return undefined;
            const index = await host.index().catch(() => undefined);
            if (!index || signal.aborted) return undefined;
            const recall = await index.recall(query);
            if (signal.aborted || recall.hits.length === 0) return undefined;
            const own = recall.hits.filter((h) => !h.expanded);
            const confidence = hitConfidence(own, recall.tiers);
            const opts = { max: host.max ?? 8 };
            const focus = [...new Set(shownHits(recall.hits, opts).map((h) => h.id).filter((id) => pathOfRef(id) !== undefined || id.startsWith('ent:') || id.startsWith('fact:')))].slice(0, CHIP_FOCUS_MAX);
            return {
                actionId: KNOWLEDGE_ASK,
                text: renderKnowledgeAnswer(query, recall.hits, opts),
                context: renderKnowledgeContext(query, recall.hits, recall.tiers, opts),
                confidence,
                ...(focus.length ? { chips: [openInGraphChip({ rootId: focus.map(rootIdOfSourceRef).find((r) => r !== undefined), focus })] } : {}),
                data: { digest: recall.digest, tiers: recall.tiers, hits: own.length, top: own[0]?.tier ?? null, confidence },
            };
        },
    };
}
