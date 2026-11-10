/**
 * "Release run" on a held run delta card (PRD 41 §12.5): the person confirms in the shared confirm modal (a destructive-
 * style approval: the run is marked complete despite its blocking findings; there is no "always"), then the webview asks
 * the host (`run-delta/release { runId }`). The host re-posts the run's cards `released: true`, which the card shows; a
 * refusal shows on the card in its own localized words (`RUN_DELTA_RELEASE_REFUSED`: no longer held, still being recorded,
 * signed out, not an approver; anything else — a timeout, an older host — reads as an error).
 */

import { useCallback, useMemo, useState } from 'react';
import { useConfirm } from '@/components/confirmContext';
import { releaseConfirmText, type RunDeltaLabels } from '@builderforce/knowledge-graph-view/delta';
import { request } from '../../vscodeBridge';
import { RUN_DELTA_RELEASE, releaseRefusalOf, type RunDeltaReleaseRefusal } from './runDeltaCards';

export interface RunDeltaRelease {
  /** Runs whose release is in flight. */
  releasing: ReadonlySet<string>;
  /** Runs the host refused to release, and why. */
  refused: ReadonlyMap<string, RunDeltaReleaseRefusal>;
  release(runId: string, rules: readonly string[]): void;
}

/** Confirm, then post: the pure half of {@link useRunDeltaRelease}, for tests. Resolves `released`, `cancelled` or the refusal. */
export async function releaseRun(
  runId: string,
  rules: readonly string[],
  labels: RunDeltaLabels,
  confirm: (opts: { title: string; message: string; confirmLabel: string; destructive: true }) => Promise<boolean>,
  send: (type: typeof RUN_DELTA_RELEASE, payload: { runId: string }) => Promise<unknown>,
): Promise<'released' | 'cancelled' | { refused: RunDeltaReleaseRefusal }> {
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
  } catch (error) {
    return { refused: releaseRefusalOf(error instanceof Error ? error.message : String(error)) };
  }
}

const toggle = (set: ReadonlySet<string>, id: string, on: boolean): Set<string> => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

const withRefusal = (map: ReadonlyMap<string, RunDeltaReleaseRefusal>, id: string, refusal: RunDeltaReleaseRefusal | undefined) => {
  const next = new Map(map);
  if (refusal) next.set(id, refusal);
  else next.delete(id);
  return next;
};

export function useRunDeltaRelease(labels: RunDeltaLabels): RunDeltaRelease {
  const confirm = useConfirm();
  const [releasing, setReleasing] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<ReadonlyMap<string, RunDeltaReleaseRefusal>>(new Map());
  const release = useCallback((runId: string, rules: readonly string[]) => {
    setRefused((m) => withRefusal(m, runId, undefined));
    setReleasing((s) => toggle(s, runId, true));
    void releaseRun(runId, rules, labels, confirm, (type, payload) => request(type, payload)).then((outcome) => {
      setReleasing((s) => toggle(s, runId, false));
      if (typeof outcome === 'object') setRefused((m) => withRefusal(m, runId, outcome.refused));
    });
  }, [confirm, labels]);
  return useMemo(() => ({ releasing, refused, release }), [releasing, refused, release]);
}
