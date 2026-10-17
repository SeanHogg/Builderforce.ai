import type { TimelineNode } from '../timelineModel';
import { dotIcon } from './dotIcon';
import type { BrainTimelineLabels } from './labels';

/**
 * The project-Evermind memory steps — recall (before answering), a memory-first answer,
 * learn + reconcile (after). Each is a muted step line in the gutter lineage.
 */

/** The muted one-line memory row the memoryAnswer / learn / reconcile steps share. */
function MemoryLine({ kind, title, hint }: { kind: TimelineNode['kind']; title: string; hint?: string }) {
  return (
    <li className="bf-tl__item bf-tl__item--memory">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--muted">{dotIcon(kind)}</span>
      </span>
      <div className="bf-tl__body">
        <span className="bf-tl__memory-line" title={hint}>{title}</span>
      </div>
    </li>
  );
}

export function RecallRow({ node, labels }: { node: Extract<TimelineNode, { kind: 'recall' }>; labels: BrainTimelineLabels }) {
  const title = labels.recallTitle
    .replace('{count}', String(node.count))
    .replace('{version}', String(node.version));
  return (
    <li className="bf-tl__item bf-tl__item--memory">
      <span className="bf-tl__gutter">
        <span className="bf-tl__dot bf-tl__dot--muted">{dotIcon('recall')}</span>
      </span>
      <div className="bf-tl__body">
        <details className="bf-tl__tool bf-tl__memory">
          <summary className="bf-tl__tool-head" title={labels.recallHint}>
            <span className="bf-tl__tool-name">{title}</span>
            <span className="bf-tl__tool-caret" aria-hidden>▸</span>
          </summary>
          <div className="bf-tl__tool-body">
            <ol className="bf-tl__memory-list">
              {node.items.map((it) => (
                <li key={it.id} className="bf-tl__memory-item">
                  <span className="bf-tl__memory-score" aria-hidden>{Math.round(it.score * 100)}%</span>
                  <span className="bf-tl__memory-text">{it.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
    </li>
  );
}

export function MemoryAnswerRow({ node, labels }: { node: Extract<TimelineNode, { kind: 'memoryAnswer' }>; labels: BrainTimelineLabels }) {
  const title = node.source === 'evermind' && node.version != null
    ? labels.memoryAnswerEvermind.replace('{version}', String(node.version))
    : labels.memoryAnswerCache;
  return <MemoryLine kind="memoryAnswer" title={title} hint={labels.memoryAnswerHint} />;
}

export function LearnRow({ node, labels }: { node: Extract<TimelineNode, { kind: 'learn' }>; labels: BrainTimelineLabels }) {
  // Multi-target: a project can fan out to MANY Everminds (its own head + its IDE
  // builds). Name EACH by id + version so a fan-out is triageable — the same detail
  // the native chat chip shows. Falls back to the single-line phrasing below when
  // the server sent no per-target breakdown (older turns / summary only).
  if (node.targets && node.targets.length > 0) {
    const lines = node.targets
      .map((tg) => {
        if (tg.learned) {
          return labels.learnTargetContributed
            .replace('{name}', tg.name).replace('{projectId}', String(tg.projectId)).replace('{version}', String(tg.version));
        }
        const reasonLabel = tg.reason && tg.reason !== 'too-short'
          ? labels.learnSkipReason[tg.reason as 'not-attached' | 'not-seeded' | 'frozen']
          : null;
        return reasonLabel
          ? labels.learnTargetSkipped.replace('{name}', tg.name).replace('{projectId}', String(tg.projectId)).replace('{reason}', reasonLabel)
          : null;
      })
      .filter((s): s is string => !!s);
    if (lines.length === 0) return null;
    return <MemoryLine kind="learn" title={lines.join('; ')} />;
  }
  // Skipped: the turn did NOT feed the Evermind for a project-level reason —
  // render an explained muted line so the absence is never a silent mystery.
  const title = node.skipped
    ? labels.learnSkippedTitle.replace('{reason}', labels.learnSkipReason[node.skipped])
    : labels.learnTitle.replace('{version}', String(node.version));
  const hint = node.skipped ? labels.learnSkippedHint : labels.learnHint;
  return <MemoryLine kind="learn" title={title} hint={hint} />;
}

export function ReconcileRow({ node, labels }: { node: Extract<TimelineNode, { kind: 'reconcile' }>; labels: BrainTimelineLabels }) {
  const title = labels.reconcileTitle
    .replace('{count}', String(node.count))
    .replace('{version}', String(node.version));
  return <MemoryLine kind="reconcile" title={title} hint={labels.reconcileHint} />;
}
