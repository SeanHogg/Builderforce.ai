/**
 * The personality line under each @-mention option - from the SAME assignee-profile
 * map the board hovercard reads, loaded once per tenant and cached. The dropdown
 * calls the returned function per row per render, so it is a plain map lookup:
 * opening the picker or typing in it triggers no request.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DirectedRecipient } from '@seanhogg/builderforce-brain-embedded';
import type { AssigneeProfileMap } from '@/lib/builderforceApi';
import { useOptionalAuth } from '@/lib/AuthContext';
import { loadAssigneeProfileMap } from '@/lib/assigneeProfilesCache';
import { loadPsychometricCatalog } from '@/lib/usePsychometricCatalog';
import type { PsychometricCatalog } from '@/lib/psychometric';
import { personalityOneLiner, type OneLinerPhrases } from '@/lib/personalityOneLiner';
import { recordedFailure } from '@/lib/reportError';

/** Select-value the profile map is keyed by: `u:<userId>` humans, `c:<agentRef>` cloud agents. */
const selectValueOf = (r: DirectedRecipient): string => `${r.kind === 'human' ? 'u' : 'c'}:${r.ref}`;

/** `enabled` false (no mentionable participants) loads nothing. */
export function useMentionPersonalityDetail(enabled: boolean): (r: DirectedRecipient) => string | undefined {
  const t = useTranslations('mentionPersonality');
  const tenantKey = useOptionalAuth()?.tenant?.id ?? 'none';
  const [profiles, setProfiles] = useState<AssigneeProfileMap | null>(null);
  const [catalog, setCatalog] = useState<PsychometricCatalog | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // Best-effort: a failure leaves the dropdown exactly as it was.
    void loadAssigneeProfileMap(String(tenantKey))
      .then((m) => { if (live) setProfiles(m); })
      .catch(recordedFailure('Reading the assignee profiles for @-mentions', undefined));
    void loadPsychometricCatalog(String(tenantKey))
      .then((c) => { if (live) setCatalog(c); })
      .catch(recordedFailure('Reading the psychometric catalog for @-mentions', undefined));
    return () => { live = false; };
  }, [enabled, tenantKey]);

  const phrases = useMemo<OneLinerPhrases>(() => ({
    mbti: (value) => t('mbti', { value }),
    enneagram: (type) => t('enneagram', { type }),
    trait: (band, name) => t(band === 'high' ? 'high' : 'low', { name }),
  }), [t]);

  return useCallback((r: DirectedRecipient) => {
    const profile = profiles?.[selectValueOf(r)];
    return profile ? personalityOneLiner(profile.psychometric, catalog, phrases) || undefined : undefined;
  }, [profiles, catalog, phrases]);
}
