/**
 * The project's Evermind, stated as the TWO facts it actually has — whether chats are
 * teaching it (connected ⇒ learning) and whether it may answer instead of a paid model
 * (`inferenceEnabled`). The old badge folded both into one word, so "Off" read as
 * "memory is off" when it only meant "does not answer", and hid that it was learning.
 *
 * Self-gating: fetches the (server-cached) head itself and renders nothing until the
 * project has a seeded Evermind.
 */
import { useEffect, useState } from 'react';
import type { JsonRequest } from './consumptionSnapshot';
import { fill } from '../spend/format';
import type { WorkStatusLabels } from './labels';

interface EvermindHeadLite {
  version: number;
  mode: 'connected' | 'offline-frozen' | string;
  inferenceEnabled: boolean;
}

export interface EvermindStatusProps {
  request: JsonRequest;
  projectId: number | null;
  labels: WorkStatusLabels;
}

export function EvermindStatus({ request, projectId, labels }: EvermindStatusProps) {
  const [head, setHead] = useState<EvermindHeadLite | null>(null);
  useEffect(() => {
    if (projectId == null) { setHead(null); return undefined; }
    let alive = true;
    request<EvermindHeadLite>(`/api/projects/${projectId}/evermind/head`)
      .then((h) => { if (alive) setHead(h); })
      .catch(() => { if (alive) setHead(null); });
    return () => { alive = false; };
  }, [request, projectId]);

  if (!head || head.version < 1) return null;
  const learning = head.mode === 'connected';
  return (
    <div className="bf-acct__row bf-evstatus" title={labels.evermindHint}>
      <span className="bf-acct__k">
        <span aria-hidden>🧠 </span>
        {labels.evermind} {fill(labels.evermindVersion, { version: String(head.version) })}
      </span>
      <span className="bf-acct__v">
        <span className={`bf-evstatus__dot${learning ? ' is-on' : ''}`} aria-hidden />
        {learning ? labels.evermindLearning : labels.evermindFrozen}
        {' · '}
        {head.inferenceEnabled ? labels.evermindAnswersOn : labels.evermindAnswersOff}
      </span>
    </div>
  );
}
