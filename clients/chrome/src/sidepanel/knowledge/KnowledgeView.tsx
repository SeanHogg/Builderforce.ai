/**
 * The Knowledge destination's body: THE ONE `KnowledgeGraphView` (the same view the web
 * canvas and the VS Code panel mount) over the source Rovr built, or — when it cannot be
 * built yet — why, in Rovr's words, with the way to Settings. With a source and no folder
 * reviewed, the view explains itself and offers **Review a folder**.
 *
 * Presentational: the composition (session, project, source) is `KnowledgeDestination`.
 */

import { KnowledgeGraphView, type KnowledgeGraphLabels, type KnowledgeGraphSource } from '@builderforce/knowledge-graph-view';
import { t } from '../../i18n/t';
import type { KnowledgeTabIntent } from './knowledgeChips';

/** Why there is no source: signed out, or no project chosen (Settings → File new tasks in). */
export type KnowledgeGap = 'signedOut' | 'noProject';

export interface KnowledgeViewProps {
  source: KnowledgeGraphSource | null;
  gap: KnowledgeGap | null;
  labels: KnowledgeGraphLabels;
  /** *Fix with agent*: seeds Rovr's ONE composer (the person presses send). */
  onCompose?(text: string): void;
  onOpenSettings(): void;
  /** Open on a chat chip's intent; a new `seq` remounts the view on it. */
  intent?: KnowledgeTabIntent | null;
}

export function KnowledgeView({ source, gap, labels, onCompose, onOpenSettings, intent = null }: KnowledgeViewProps) {
  return (
    <section className="rovr-knowledge" aria-label={t('tabKnowledge')} data-testid="rovr-knowledge">
      {source && !gap ? (
        <KnowledgeGraphView
          key={intent?.seq ?? 0}
          source={source}
          labels={labels}
          {...(intent && intent.focus.length > 0 ? { initialFocus: intent.focus } : {})}
          openReview={!!intent?.review}
          {...(onCompose ? { onCompose } : {})}
        />
      ) : (
        <div className="rovr-card rovr-stack rovr-knowledge__gap" role="status">
          <p className="rovr-muted">{t('knowledgeDescription')}</p>
          <h2 className="rovr-h2">{t(gap === 'signedOut' ? 'knowledgeSignedOutTitle' : 'knowledgeNoProjectTitle')}</h2>
          <p>{t(gap === 'signedOut' ? 'knowledgeSignedOutBody' : 'knowledgeNoProjectBody')}</p>
          <button type="button" className="bf-btn" onClick={onOpenSettings}>{t('knowledgeOpenSettings')}</button>
        </div>
      )}
    </section>
  );
}
