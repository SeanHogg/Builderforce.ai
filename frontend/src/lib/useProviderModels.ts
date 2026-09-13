'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LlmProvider, ProviderAuthType } from './builderforceApi';
import { providerModelsApi, type ProviderModelsView } from './providerModelsApi';

/**
 * State for one provider's model selection: the server view, a local DRAFT of the order
 * (edited freely, saved on demand) and whether the draft differs from what is saved.
 *
 * `authType` is both the gate and the re-read trigger: nothing is fetched for an account
 * that is not connected, and connecting (or switching how it is connected) reloads the
 * list, because a different key can serve a different set of models.
 */
export function useProviderModels(provider: LlmProvider, authType: ProviderAuthType | null) {
  const [view, setView] = useState<ProviderModelsView | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authType === null) return;
    let live = true;
    providerModelsApi.list(provider)
      .then((next) => {
        if (!live) return;
        setView(next);
        setDraft(next.selected);
        setError(null);
      })
      .catch((e: unknown) => { if (live) setError(e); });
    return () => { live = false; };
  }, [provider, authType]);

  /** Persist the draft. Throws on failure so the caller can say so in its own words. */
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const result = await providerModelsApi.save(provider, draft);
      setView((current) => (current ? { ...current, selected: result.selected } : current));
      setDraft(result.selected);
    } finally {
      setSaving(false);
    }
  }, [provider, draft]);

  const saved = view?.selected ?? [];
  const dirty = draft.length !== saved.length || draft.some((id, i) => id !== saved[i]);

  return { view, draft, setDraft, error, saving, save, dirty };
}
