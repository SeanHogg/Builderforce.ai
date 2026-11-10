/**
 * "Release run" on a held run delta card (PRD 41 §12.5): the person confirms in the shared confirm modal (a destructive-
 * style approval: the run is marked complete despite its blocking findings; there is no "always"), then the webview asks
 * the host (`run-delta/release { runId }`). The host re-posts the run's cards `released: true`, which the card shows; a
 * refusal (`run_delta_release_refused`, or any failure) shows the localized refusal on the card.
 */

import { useCallback, useMemo, useState } from 'react';
import { useConfirm } from '@/components/confirmContext';
import { releaseConfirmText, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { request } from '../../vscodeBridge';
import { RUN_DELTA_RELEASE } from './runDeltaCards';

export interface RunDeltaRelease {
  /** Runs whose release is in flight. */
  releasing: ReadonlySet<string>;
  /** Runs the host refused to release. */
  refused: ReadonlySet<string>;
  release(runId: string, rules: readonly string[]): void;
}

/** Confirm, then post: the pure half of {@link useRunDeltaRelease}, for tests. Resolves `released`, `cancelled` or `refused`. */
export async function releaseRun(
  runId: string,
  rules: readonly string[],
  labels: RunDeltaLabels,
  confirm: (opts: { title: string; message: string; confirmLabel: string; destructive: true }) => Promise<boolean>,
  send: (type: typeof RUN_DELTA_RELEASE, payload: { runId: string }) => Promise<unknown>,
): Promise<'released' | 'cancelled' | 'refused'> {
  const ok = await confirm({
    title: labels.releaseConfirmTitle,
    message: releaseConfirmText(labels, rules),
    confirmLabel: labels.releaseConfirmLabel,
    destructive: true,
  });
  if (!ok) return 'cancelled';
  try {
    await send(RUN_DELTA_RELEASE, { runId });
    return 'released';
  } catch {
    return 'refused';
  }
}

const toggle = (set: ReadonlySet<string>, id: string, on: boolean): Set<string> => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

export function useRunDeltaRelease(labels: RunDeltaLabels): RunDeltaRelease {
  const confirm = useConfirm();
  const [releasing, setReleasing] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<ReadonlySet<string>>(new Set());
  const release = useCallback((runId: string, rules: readonly string[]) => {
    setRefused((s) => toggle(s, runId, false));
    setReleasing((s) => toggle(s, runId, true));
    void releaseRun(runId, rules, labels, confirm, (type, payload) => request(type, payload)).then((outcome) => {
      setReleasing((s) => toggle(s, runId, false));
      if (outcome === 'refused') setRefused((s) => toggle(s, runId, true));
    });
  }, [confirm, labels]);
  return useMemo(() => ({ releasing, refused, release }), [releasing, refused, release]);
}
