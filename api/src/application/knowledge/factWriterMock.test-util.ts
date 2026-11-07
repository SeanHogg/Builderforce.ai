/**
 * The fact writer's batch call over a test's single-fact spy (PRD 41 A11 rule 4a): `writeKnowledge` calls
 * `upsertProjectFacts`; a test that pins what is written per fact mocks `upsertProjectFact` and wraps it here,
 * so its assertions on each fact's arguments keep holding.
 */
export function batchOverSingle(
  upsert: (env: unknown, db: unknown, tenantId: number, projectId: number, key: string, content: string, source: string, opts: unknown) => Promise<boolean>,
) {
  return async (
    env: unknown, db: unknown, tenantId: number, projectId: number,
    items: ReadonlyArray<{ key: string; content: string; source?: string; opts?: unknown }>,
  ): Promise<Set<string>> => {
    const written = new Set<string>();
    for (const it of items) {
      if (await upsert(env, db, tenantId, projectId, it.key, it.content, it.source ?? 'agent', it.opts)) written.add(it.key);
    }
    return written;
  };
}
