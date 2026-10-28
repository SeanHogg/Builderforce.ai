/**
 * THE KNOWLEDGE DESTINATION (PRD 38 WS6) — Rovr's side-panel view of a project's
 * knowledge graph. A lazy chunk of the panel (`App.tsx` imports it with `React.lazy`), and
 * the view's 3D scene a lazy chunk of this one, so opening the panel never parses either.
 *
 * Knowledge is kept per project, and Rovr's project is the one Settings files tasks in
 * (`taskProjectId` — the same project the chat's project memory reads). Signed out, or
 * with no project chosen, the destination says so and points at Settings.
 */

import { useMemo } from 'react';
import { t } from '../../i18n/t';
import { useServices, useSetting, useSignedIn } from '../hooks';
import { rovrKnowledgeLabels } from './knowledgeLabels';
import { KnowledgeView, type KnowledgeGap } from './KnowledgeView';
import { createRovrKnowledgeSource } from './rovrKnowledgeSource';
import type { KnowledgeTabIntent } from './knowledgeChips';

export interface KnowledgeDestinationProps {
  onCompose(text: string): void;
  onOpenSettings(): void;
  /** What a chat answer's chip opened the tab on (focused refs, or the review launcher). */
  intent?: KnowledgeTabIntent | null;
}

export default function KnowledgeDestination({ onCompose, onOpenSettings, intent }: KnowledgeDestinationProps) {
  const services = useServices();
  const signedIn = useSignedIn();
  // `undefined` until the setting's first read lands — never flash "choose a project".
  const projectId = useSetting<number | null | undefined>((s) => s.taskProjectId(), undefined);
  const labels = useMemo(() => rovrKnowledgeLabels(), []);
  const gap: KnowledgeGap | null = !signedIn ? 'signedOut' : projectId === null ? 'noProject' : null;
  const source = useMemo(
    () => (gap || projectId == null ? null : createRovrKnowledgeSource({ projectId, fetch: services.apiFetch, reportError: services.reportError })),
    [gap, projectId, services],
  );

  if (signedIn && projectId === undefined) return <p className="rovr-empty">{t('loading')}</p>;
  return <KnowledgeView source={source} gap={gap} labels={labels} onCompose={onCompose} onOpenSettings={onOpenSettings} intent={intent ?? null} />;
}
