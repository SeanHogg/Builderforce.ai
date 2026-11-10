/**
 * The source files the architecture cameras (4+1, Architecture style, Key features) read: code-pack files whose
 * category is `source` (tests import everything and would blur the picture), never a stray copy of another system
 * (it would count the same code twice). Each camera's `available` rule asks {@link hasSourceFiles}, so a graph with
 * no code hides them. Computed once per graph.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fileCategory } from '../fileCategory';
import { weakMemo } from '../memo';
import { fileNodesOf } from './outlineGraph';

const memo = weakMemo(
    (graph: KnowledgeGraph): KNode[] => fileNodesOf(graph).filter((n) => n.pack === 'code' && !n.copyOf && fileCategory(n) === 'source'),
    (graph) => graph,
);

/** The source files of the graph (read-only: shared by every reader). */
export const sourceFilesOf = (graph: KnowledgeGraph): readonly KNode[] => memo(graph);

export const hasSourceFiles = (graph: KnowledgeGraph): boolean => sourceFilesOf(graph).length > 0;
