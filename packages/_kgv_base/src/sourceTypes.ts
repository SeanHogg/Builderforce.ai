/** The source / revision port types (split out of `types.ts`, which re-exports every name): file text, commits, baseline and snapshot. */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';

/** Lines of a file, 1-based and inclusive. */
export interface SourceRange { startLine: number; endLine: number }

/** What `readSource` answers: the lines from `startLine`, and whether the host cut the range short (its line cap). */
export interface SourceText { startLine: number; lines: string[]; truncated: boolean }

/** `KnowledgeGraphSource.readSource` bound to the root on show (the view's code band reads through it). */
export type SourceReader = (path: string, range: SourceRange) => Promise<SourceText | null>;

/** `KnowledgeGraphSource.readSourceAt` bound to the root on show: a file's lines as they were at the commit `rev`. */
export type SourceReaderAt = (path: string, rev: string, range: SourceRange) => Promise<SourceText | null>;

/** One commit of the root: the time slider's dot, the changed set (`refs`) and the Sync delta feed's row. THE one commit type. */
export interface Commit {
    sha: string;
    /** The first parent's sha, when the host knows it: a commit comparison's Before reads the file there (the file as the commit found it). */
    parent?: string;
    title: string;
    at: string;
    /** The node refs the commit touched. */
    refs: string[];
    /** Who made it, when the host knows. */
    author?: string;
}

/** Compare's "before". */
export interface KnowledgeBaseline {
    graph: KnowledgeGraph;
    /**
     * `false` ⇒ before and after cannot be measured against each other (an analyzer failed
     * or changed on one side): Compare says so instead of reporting a missing finding as
     * resolved. Default true.
     */
    comparable?: boolean;
    /** Why not (memory's `comparable()` reason codes, PRD 41 §C9): Compare shows each, localized. */
    reasons?: readonly string[];
    /** The commit sha the baseline was taken at, when the host knows it: `readSourceAt` reads the "before" source at it. */
    rev?: string;
}

export interface KnowledgeSnapshot {
    graph: KnowledgeGraph;
    title?: string;
    baseline?: KnowledgeBaseline | null;
    /** The commit sha the snapshot was taken at, when the host knows it: `readSourceAt` reads that revision's source. */
    rev?: string;
}
