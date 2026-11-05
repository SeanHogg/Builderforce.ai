/**
 * The browser's `syncStatus` (PRD 38, Option B+ Contract 4). The browser has no git, no
 * coverage folder and no CODEOWNERS file to read, so each source's state is read off what
 * the SERVER graph carries: a code file with the badge means the source was collected when
 * the review ran. A source with no badge anywhere is `absent` (not set up), never a number.
 *
 *   server   the platform graph's `stats` (agent-tools `graphCounts`);
 *   local    the last review's recorded plan counts (files and docs, skipped files not
 *            counted), kept in sessionStorage; zeros when none was recorded;
 *   skipped  the last review's recorded list (plan skips, skipped folders, uploads skipped
 *            during it); absent when none was recorded = unknown, not "none".
 */

import { CODE_BADGES, graphCounts, reviewRecordStore, type RecordPersistence, type ReviewRecord } from '@builderforce/agent-tools/knowledge';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
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
}

export function browserSyncStatus(input: BrowserSyncInput): SyncStatus {
  const server = input.graph ? graphCounts(input.graph) : undefined;
  const local: Counts = { files: input.record?.counts.files ?? 0, docs: input.record?.counts.docs ?? 0 };
  return {
    local,
    ...(server ? { server } : {}),
    ...(input.record ? { skipped: input.record.skipped } : {}),
    sources: sourceStates(input.graph, server ?? local, !!input.record || !!server),
  };
}
