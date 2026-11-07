/**
 * ONE complete `KnowledgeStorePort` double for the knowledge tests: every member answers "nothing", so a test names
 * only the members it cares about (`storeMock({ factAuthor: … })`) and a new port member is added here once, not in
 * every test's own literal.
 */
import { vi } from 'vitest';
import type { StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeStorePort } from './knowledgePorts';

export function storeMock(over: Partial<KnowledgeStorePort> = {}): KnowledgeStorePort {
  return {
    scopes: vi.fn(async () => []),
    scope: vi.fn(async () => null),
    facts: vi.fn(async () => []),
    relations: vi.fn(async () => []),
    upsertRelations: vi.fn(async (rows: readonly StoredRelation[]) => rows.length),
    upsertScope: vi.fn(async () => undefined),
    markRelationsStale: vi.fn(async () => 0),
    markRelationsStaleMany: vi.fn(async () => 0),
    deleteRelationsOf: vi.fn(async () => 0),
    deleteRelationRows: vi.fn(async () => 0),
    deleteFactsByKeys: vi.fn(async () => []),
    relationsTouching: vi.fn(async () => []),
    deleteScope: vi.fn(async () => false),
    factSources: vi.fn(async () => new Map<string, string>()),
    deleteFactsBySource: vi.fn(async () => ({ keys: [], relations: 0 })),
    humanRelationKeys: vi.fn(async () => new Set<string>()),
    deleteRelationsUnder: vi.fn(async () => 0),
    factAuthor: vi.fn(async () => undefined),
    factAuthors: vi.fn(async () => new Map<string, string | null>()),
    ...over,
  };
}
