'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { knowledgeApi, type CreateDocInput } from '@/lib/knowledgeApi';

/**
 * One place that turns "I picked a template" into a created draft + a jump into
 * the editor. Shared by the Knowledge home's gap list and the /knowledge/new
 * template gallery so the create-then-open flow can never drift between them.
 * Replaces the old blocking create-modal entirely (Google-Docs style: choose a
 * template, the document opens).
 */
export function useCreateKnowledge(projectId: number | null = null) {
  const router = useRouter();
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: CreateDocInput & { busyKey?: string }) => {
      const busyKey = input.busyKey ?? input.templateKey ?? input.docType ?? 'new';
      setCreatingKey(busyKey);
      setError(null);
      try {
        const { busyKey: _omit, ...payload } = input;
        const doc = await knowledgeApi.create({ projectId, ...payload });
        router.push(`/knowledge/${doc.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create document');
        setCreatingKey(null);
      }
    },
    [projectId, router],
  );

  return { create, creatingKey, error };
}
