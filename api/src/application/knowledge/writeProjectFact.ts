/**
 * writeProjectFact — how every NON-person writer puts an anchored fact into project memory
 * (PRD 38 §4.2: `writeKnowledge` is the ONE writer). Governed memory (`memory_remember`,
 * run-end outcomes and code maps), the Brain's `project_facts.remember`, chat-summary facts
 * and the Evermind learning pipeline all call this; it is `writeKnowledge` as a machine
 * caller (`userId` null), so the origin is stamped `agent` SERVER-side, the row bound and the
 * origin check apply, and the knowledge version is bumped once.
 *
 * Not used by the Q&A replay cache (`projectMemory.ts`): that is a cache, excluded from the
 * graph, and has no author or origin.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { FactFileAnchor, FactOriginCost } from '../llm/projectFactsStore';
import { writeKnowledge, type KnowledgeWriteResult } from './writeKnowledge';
import { knowledgeWritePortsFor } from './knowledgeWritePorts';

export interface ProjectFactWrite {
  key: string;
  content: string;
  /** Provenance label (`cloud-run`, `brain`, `chat-archive`, …). */
  source: string;
  expiresAt?: Date | null;
  originExecutionId?: number | null;
  /** What producing the fact cost (model + tokens). */
  origin?: FactOriginCost | null;
  importance?: number;
  fileAnchors?: FactFileAnchor[];
  /** The single-subject anchor sweep (a fact about one file corrects an older one). Default off. */
  retireByAnchor?: boolean;
}

type ProjectFactDeps = { env: Env; db: Db; tenantId: number; projectId: number };

/** Whether the fact was written (false = invalid project, empty key or empty content, or a
 *  key a person authored). A caller that must tell those apart reads {@link writeProjectFactResult}. */
export async function writeProjectFact(deps: ProjectFactDeps, fact: ProjectFactWrite): Promise<boolean> {
  return (await writeProjectFactResult(deps, fact)).factsWritten > 0;
}

/** The writer's whole answer: `factsWritten`, and `factsSkipped` when a person owns the key. */
export async function writeProjectFactResult(deps: ProjectFactDeps, fact: ProjectFactWrite): Promise<KnowledgeWriteResult> {
  const { store, extracted } = knowledgeWritePortsFor(deps.env, deps.db, deps.tenantId, deps.projectId);
  return writeKnowledge(
    {
      ...deps, store, blobs: extracted, userId: null,
      legacyFact: {
        originExecutionId: fact.originExecutionId ?? null,
        origin: fact.origin ?? null,
        retireByAnchor: fact.retireByAnchor ?? false,
      },
    },
    {
      facts: [{
        key: fact.key, content: fact.content, source: fact.source, origin: 'agent',
        fileAnchors: fact.fileAnchors ?? [],
        ...(fact.importance != null ? { importance: fact.importance } : {}),
        ...(fact.expiresAt !== undefined ? { expiresAt: fact.expiresAt } : {}),
      }],
    },
  );
}
