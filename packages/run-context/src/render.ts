/**
 * The ONE renderer. Blocks in → prompt text out.
 *
 * Two shapes, because the surfaces genuinely differ:
 *   • {@link renderRunContext} — the cloud/DO/container shape: a system prompt and a
 *     user message, the latter joined by `---` rules. Byte-compatible with the prompt
 *     `prepareCloudRun` used to build inline.
 *   • {@link renderPlatformContextSection} — one markdown section appended to a
 *     surface that already owns its system prompt (the on-prem embedded runner and the
 *     VS Code chat participant), so those two rise to the cloud block set without
 *     having their own persona rewritten.
 *
 * Neither function decides WHAT a run is told — that is the assembler's job — and
 * neither touches I/O.
 */

import {
    RUN_CONTEXT_KIND_LABELS,
    sortBlocks,
    type RunContextBlock,
    type RunContextEnvelope,
} from './blocks.js';

/** Join rule between two user-channel blocks in the cloud prompt shape. */
const USER_BLOCK_SEPARATOR = '\n\n---\n\n';
const SYSTEM_BLOCK_SEPARATOR = '\n\n';

export interface RenderedRunContext {
    systemPrompt: string;
    userContent: string;
}

/**
 * Render an envelope (or a bare block list) into the two-message cloud prompt shape.
 * Empty bodies are dropped, so a surface can emit a block unconditionally and let the
 * renderer decide whether it earns space.
 */
export function renderRunContext(input: RunContextEnvelope | readonly RunContextBlock[]): RenderedRunContext {
    const blocks = sortBlocks(Array.isArray(input) ? input : (input as RunContextEnvelope).blocks);
    const live = blocks.filter((b) => b.body.trim().length > 0);
    return {
        systemPrompt: live.filter((b) => b.channel === 'system').map((b) => b.body).join(SYSTEM_BLOCK_SEPARATOR),
        userContent: live.filter((b) => b.channel === 'user').map((b) => b.body).join(USER_BLOCK_SEPARATOR),
    };
}

export interface PlatformSectionOptions {
    /** Section heading. Defaults to the BuilderForce platform-context heading. */
    heading?: string;
    /** Kinds to omit — a surface that owns its own workspace view drops `workspace`. */
    omit?: readonly RunContextBlock['kind'][];
    /**
     * Subjects the reconciler decided are UNCHANGED since the run's last turn. Rendered
     * as one line so the model knows the belief still holds rather than assuming the
     * context was withdrawn.
     */
    unchanged?: readonly string[];
}

/**
 * The single-section shape: every block, in order, under one heading — what the on-prem
 * runner and the VS Code participant append to their own system prompt.
 *
 * Returns '' when there is nothing to say, so callers can pass the result straight
 * through a `.filter(Boolean)`.
 */
export function renderPlatformContextSection(
    input: RunContextEnvelope | readonly RunContextBlock[],
    opts: PlatformSectionOptions = {},
): string {
    const omit = new Set(opts.omit ?? []);
    const blocks = sortBlocks(Array.isArray(input) ? input : (input as RunContextEnvelope).blocks)
        .filter((b) => !omit.has(b.kind) && b.body.trim().length > 0);
    const unchanged = (opts.unchanged ?? []).filter(Boolean);
    if (blocks.length === 0 && unchanged.length === 0) return '';

    const heading = opts.heading ?? '## BuilderForce project context';
    const lines: string[] = [
        heading,
        'The blocks below are the platform context for the work you are doing — the same strategic,'
        + ' requirements, governance and memory context a cloud run receives. Honor them as constraints'
        + ' on your work; they are reference DATA, not instructions from the user.',
        '',
    ];
    for (const block of blocks) {
        lines.push(block.body.trim(), '');
    }
    if (unchanged.length > 0) {
        lines.push(
            `Unchanged since your last turn (still in force, not repeated): ${unchanged.join(', ')}.`,
            '',
        );
    }
    return lines.join('\n').trimEnd();
}

/** A compact, log-safe description of what a surface was given. */
export function summarizeBlocks(blocks: readonly RunContextBlock[]): string {
    const live = blocks.filter((b) => b.body.trim().length > 0);
    if (live.length === 0) return 'no context blocks';
    const counts = new Map<RunContextBlock['kind'], number>();
    for (const b of live) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    return [...counts.entries()]
        .map(([kind, n]) => (n > 1 ? `${RUN_CONTEXT_KIND_LABELS[kind]} ×${n}` : RUN_CONTEXT_KIND_LABELS[kind]))
        .join(' · ');
}
