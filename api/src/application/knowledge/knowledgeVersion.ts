/**
 * knowledgeVersion — the per-project version token every cached knowledge graph keys on
 * (PRD 38 §4.8: `kg:v3:…:${knowledgeVersion}:…`).
 *
 * It IS the project's fact-store version token (`projectFactsStore.projectFactsVersion`),
 * not a second store. Every fact write in the platform — the facts routes, the governed
 * memory service, run-end memory, the Brain, the Evermind pipeline — already bumps that
 * token through `upsertProjectFact` / `deleteProjectFact`, so "any fact write invalidates
 * graphs" holds by construction rather than by remembering to call a second bump at each
 * of those sites. The knowledge writers that touch what the fact token did not cover —
 * relations, scope digests, uploaded perception (extracted output, analysis snapshots) —
 * bump the same token through {@link bumpKnowledgeVersion}.
 *
 * Cost of sharing: a relation write also drops the cached fact-recall sets for the
 * project. Those are re-read on the next recall; a second token would have doubled the
 * KV writes of every fact write instead.
 */
import type { Env } from '../../env';
import { bumpProjectFactsVersion, projectFactsVersion } from '../llm/projectFactsStore';

export function knowledgeVersion(env: Env, tenantId: number, projectId: number): Promise<string> {
  return projectFactsVersion(env, tenantId, projectId);
}

export function bumpKnowledgeVersion(env: Env, tenantId: number, projectId: number): Promise<void> {
  return bumpProjectFactsVersion(env, tenantId, projectId);
}
