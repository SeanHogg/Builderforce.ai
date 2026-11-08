/**
 * The browser's `syncStatus` (PRD 38, Option B+ Contract 4). The browser has no git, no
 * coverage folder and no CODEOWNERS file to read, so each source's state is read off what
 * the SERVER graph carries: a code file with the badge means the source was collected when
 * the review ran. A source with no badge anywhere is `absent` (not set up), never a number.
 *
 *   server   the platform graph's `stats` (agent-tools `graphCounts`);
 *   local    the local store's reviewed files and docs when it holds the root, else the last
 *            review's recorded plan counts (skipped files not counted), kept in sessionStorage;
 *            zeros when none was recorded;
 *   replica  the replica queue's state (what is still to send), when the source has one;
 *   skipped  the last review's recorded list (plan skips, skipped folders, coverage files the
 *            signals skipped); absent when none was recorded = unknown, not "none".
 */

import { CODE_BADGES, graphCounts, isCodePath, reviewRecordStore, type RecordPersistence, type ReviewRecord } from '@builderforce/agent-tools/knowledge';
import { isDocumentPath, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { SyncStatus } from '@builderforce/knowledge-graph-view';

type Counts = SyncStatus['local'];
type Source = SyncStatus['sources'][number];

/** Review records of this browser tab: memory, with sessionStorage behind it where there is one. */
const persistence: RecordPersistence | undefined = typeof sessionStorage === 'undefined' ? undefined : {
  read: (key) => JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown,
  write: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
};
export const reviewRecords = reviewRecordStore(persistence);

const carries = (graph: KnowledgeGraph | null, badge: string): boolean =>
  !!graph && graph.nodes.some((n) => n.pack === 'code' && n.badges?.[badge] !== undefined);

/** Each data source's state, from the badges the server graph carries. */
export function sourceStates(graph: KnowledgeGraph | null, counts: Counts, reviewed: boolean): Source[] {
  const have = (ok: boolean): Source['state'] => (ok ? 'collected' : 'absent');
  return [
    { id: 'code', state: have(reviewed && counts.files > 0) },
    { id: 'docs', state: have(reviewed && counts.docs > 0) },
    { id: 'coverage', state: have(carries(graph, CODE_BADGES.coverage)) },
    { id: 'usage', state: 'absent', note: 'No runtime usage source is connected.' },
    { id: 'traces', state: 'absent', note: 'No trace source is connected.' },
    { id: 'openapi', state: have(carries(graph, CODE_BADGES.routes)) },
    { id: 'history', state: have(carries(graph, CODE_BADGES.churn)) },
    { id: 'owners', state: have(carries(graph, CODE_BADGES.owner)) },
  ];
}

export interface BrowserSyncInput {
  graph: KnowledgeGraph | null;
  record: ReviewRecord | undefined;
  /** The local store's counts, when it holds the root; they win over the session record. */
  local?: Counts;
  /** The replica queue (what is still to send to the project): the view renders it and its Retry. */
  replica?: SyncStatus['replica'];
}

/** The local store's counts from the reviewed files (root-relative paths) its manifest lists. */
export function localCountsOf(paths: readonly string[]): Counts {
  return { files: paths.filter(isCodePath).length, docs: paths.filter(isDocumentPath).length };
}

export function browserSyncStatus(input: BrowserSyncInput): SyncStatus {
  const server = input.graph ? graphCounts(input.graph) : undefined;
  const local: Counts = input.local ?? { files: input.record?.counts.files ?? 0, docs: input.record?.counts.docs ?? 0 };
  return {
    local,
    ...(server ? { server } : {}),
    ...(input.replica ? { replica: input.replica } : {}),
    ...(input.record ? { skipped: input.record.skipped } : {}),
    sources: sourceStates(input.graph, server ?? local, !!input.record || !!server),
  };
}
