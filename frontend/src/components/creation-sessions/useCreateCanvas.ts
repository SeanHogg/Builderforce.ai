'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { creationSessionsApi } from '@/lib/builderforceApi';

/**
 * STARTING a canvas — the one place the act lives.
 *
 * Two components on the Create destination did this independently: the launcher and
 * the library each fetched `creationSessionsApi.quotas()` on mount, each kept its own
 * `creating` flag, and each wrote its own `create(...).then(router.push)`. That is two
 * network calls for one number and two copies of the rule that decides whether the
 * button is even pressable — the kind of duplicate where one side eventually learns
 * about a new limit and the other does not.
 *
 * It is also the seam the whole Create page turns on: starting a "website", starting a
 * "workflow" and starting a blank board are the SAME act with a different opening
 * prompt. Nothing here takes a kind, because there is nothing for a kind to change.
 */
export interface CreateCanvasSurface {
  /** A create call is in flight — every start control disables on it. */
  creating: boolean;
  /** The tenant is at its session limit; every start is refused until one is freed. */
  limitReached: boolean;
  /** The limit itself, for the notice that explains the refusal. `-1` = unlimited. */
  limit: number | null;
  /** Start an empty board. */
  createBlank: () => Promise<void>;
  /**
   * Start a board that opens with a request already made of it — a modality, a
   * template, a phrase somebody typed. The prompt is the ONLY thing that differs
   * between them, which is the point.
   */
  createFrom: (title: string, initialPrompt: string) => Promise<void>;
}

export function useCreateCanvas(): CreateCanvasSurface {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; limit: number } | null>(null);

  useEffect(() => {
    let active = true;
    void creationSessionsApi.quotas()
      .then((result) => { if (active) setQuota({ usage: result.usage.sessions, limit: result.limits.sessions }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const limitReached = !!quota && quota.limit !== -1 && quota.usage >= quota.limit;

  const start = useCallback(async (title: string, initialPrompt?: string) => {
    if (creating || limitReached) return;
    setCreating(true);
    try {
      const result = await creationSessionsApi.create(initialPrompt ? { title, initialPrompt } : { title });
      router.push(`/create/${result.session.id}`);
    } finally {
      setCreating(false);
    }
  }, [creating, limitReached, router]);

  return {
    creating,
    limitReached,
    limit: quota?.limit ?? null,
    createBlank: useCallback(() => start(t('untitledSession')), [start, t]),
    createFrom: useCallback((title: string, initialPrompt: string) => start(title, initialPrompt), [start]),
  };
}
