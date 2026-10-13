/**
 * The fixes a surface is about (PRD 33 §5.1): the site's ranked list, read once
 * through the client cache (`replayApi.listPrescriptions`) and narrowed here by
 * `PrescriptionMatch` — so the Overview, a funnel step, the heatmap, the player
 * and the proof scoreboard on one screen share ONE request, and every one of
 * them reads again after any write (`subscribePrescriptionChanges`).
 *
 * An inline entry point is evidence beside its own view: when the read fails it
 * shows nothing rather than an error in someone else's panel (`error` is still
 * returned for the surfaces that list fixes as their main content).
 */

import { useEffect, useMemo, useState } from 'react';
import type { ReplayFilter, ReplayPrescriptionDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { subscribePrescriptionChanges } from '@/lib/replayPrescriptionsApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { matchesPrescription, type PrescriptionMatch } from './prescriptionModel';

export interface UsePrescriptionsForInput extends PrescriptionMatch {
  /** null = nothing to read (a proof before it has a site). */
  siteId: string | null;
  /** The home's ONE filter (page and issue clauses narrow the list on the API). */
  filter?: ReplayFilter | null;
}

export interface PrescriptionsForResult {
  items: ReplayPrescriptionDto[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function usePrescriptionsFor(input: UsePrescriptionsForInput): PrescriptionsForResult {
  const { siteId, filter, subject, route, ruleId, selector } = input;
  const errorText = useErrorText();
  const [all, setAll] = useState<ReplayPrescriptionDto[]>([]);
  const [loading, setLoading] = useState(siteId != null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const filterKey = filter && filter.all.length > 0 ? JSON.stringify(filter) : '';

  useEffect(() => subscribePrescriptionChanges(() => setNonce((n) => n + 1)), []);

  useEffect(() => {
    if (!siteId) {
      setAll([]);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError('');
    replayApi.listPrescriptions(siteId, { filter: filterKey ? (JSON.parse(filterKey) as ReplayFilter) : null })
      .then((items) => { if (live) setAll(items); })
      .catch((failure: unknown) => { if (live) { setAll([]); setError(errorText(failure)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // errorText is a stable formatter; the read depends on the site, the filter and the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, filterKey, nonce]);

  const items = useMemo(
    () => all.filter((p) => matchesPrescription(p, { subject, route, ruleId, selector })),
    [all, subject, route, ruleId, selector],
  );
  return { items, loading, error, reload: () => setNonce((n) => n + 1) };
}
