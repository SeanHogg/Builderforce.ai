import { evermindLearnedStatus, type LearnedStatusInput } from './learnedStatus';

export type EvermindActionId = 'seed' | 'test' | 'enable' | 'teacher' | 'check' | 'learn' | 'merge' | 'none';

export interface EvermindActionGuideInput {
  seeded: boolean;
  inferenceEnabled: boolean;
  mode: 'connected' | 'offline-frozen';
  pending?: number;
  teacherModel?: string | null;
  quarantinedAt?: string | null;
  recent?: LearnedStatusInput[];
  eval?: { delta: number } | null;
  probe?: { ready: boolean } | null;
}

export interface EvermindNextAction {
  id: EvermindActionId;
  tone: 'good' | 'attention' | 'danger' | 'neutral';
  title: string;
  detail: string;
  destination: string;
  cta: string;
}

/** One state-to-action decision shared by every Evermind surface. */
export function evermindNextAction(input: EvermindActionGuideInput): EvermindNextAction {
  if (!input.seeded) return { id: 'seed', tone: 'attention', title: 'Set up the model', detail: 'Choose a known-good base before teaching or serving replies.', destination: 'Setup', cta: 'Choose base model' };
  if (input.quarantinedAt) {
    if (input.probe?.ready) return { id: 'enable', tone: 'good', title: 'Readiness passed — enable replies', detail: 'The current version passed the coherence gate and can be promoted back to serving.', destination: 'Run on Evermind', cta: 'Enable replies' };
    if (input.probe && !input.probe.ready && !input.teacherModel) return { id: 'teacher', tone: 'danger', title: 'Readiness failed — add a teacher', detail: 'Pin a frontier teacher so future tasks become clean exemplars instead of raw run transcripts, then teach and test again.', destination: 'Teach → Teacher model', cta: 'Choose teacher' };
    if (input.probe && !input.probe.ready) return { id: 'check', tone: 'danger', title: 'Readiness failed — check learned knowledge', detail: 'Audit recent learnings, repair bad memories, then rerun the readiness check.', destination: 'Check', cta: 'Check knowledge' };
    return { id: 'test', tone: 'danger', title: 'Quarantined — run readiness first', detail: 'Replies are safely off. Test the current version before changing inference or replacing the model.', destination: 'Test → Readiness check', cta: 'Run readiness check' };
  }

  const recent = input.recent ?? [];
  const teacherFaults = recent.filter((entry) => evermindLearnedStatus(entry).state === 'fault').length;
  if (teacherFaults > 0) return { id: 'teacher', tone: 'danger', title: 'Fix failed distillation', detail: `${teacherFaults} recent learning${teacherFaults === 1 ? '' : 's'} received no usable teacher answer. Check the pinned teacher before teaching again.`, destination: 'Teach → Teacher model', cta: 'Check teacher' };
  if ((input.pending ?? 0) > 0) return { id: 'merge', tone: 'attention', title: 'Merge queued learning', detail: `${input.pending} contribution${input.pending === 1 ? ' is' : 's are'} waiting to be folded into the next version.`, destination: 'Teach → Learn now', cta: 'Learn now' };
  if ((input.eval?.delta ?? 0) < 0) return { id: 'check', tone: 'attention', title: 'Review the latest regression', detail: 'Held-out loss increased on the latest version. Audit what changed before serving it.', destination: 'Check', cta: 'Check knowledge' };
  if (!input.inferenceEnabled) return { id: 'test', tone: 'attention', title: 'Test before enabling replies', detail: 'Run the readiness suite against the current version, then enable inference only if it passes.', destination: 'Test → Readiness check', cta: 'Run readiness check' };
  if (input.mode === 'offline-frozen') return { id: 'learn', tone: 'neutral', title: 'Learning is frozen', detail: 'Replies are live, but completed work is not updating this model.', destination: 'Learning', cta: 'Connect learning' };
  return { id: 'none', tone: 'good', title: 'No action required', detail: 'Learning is connected and replies are enabled. Review recent learnings as new work lands.', destination: 'Recently learned', cta: 'Review learnings' };
}
