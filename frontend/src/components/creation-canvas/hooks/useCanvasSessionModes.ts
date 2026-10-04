/** Auto-apply, chat/work mode and the per-session memory switch. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo } from 'react';
import { setBrainAutoApprove } from '@/lib/brain/autoApprove';
import type { ChatMode } from '@/lib/brain';
import { readLocalCreationSession, writeLocalCreationSession } from '@/domains/canvas/infrastructure/localCanvasStore';
import { type CreationSessionInvitation, creationSessionsApi, type CreationTemplate as ServerCreationTemplate } from '@/lib/builderforceApi';
import type { FramePreset } from '../canvasBoardTypes';
import { faultText } from '@/lib/apiClient';
import type { useTranslations } from 'next-intl';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';

export interface UseCanvasSessionModesDeps {
  autoApplyRef: RefObject<boolean>;
  nodes: CanvasObject[];
  persistence: 'local' | 'server';
  sessionId: string;
  sessionRole: 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';
  setAutoApply: Dispatch<SetStateAction<boolean>>;
  setDatasetRowLimit: Dispatch<SetStateAction<number>>;
  setFramePresets: Dispatch<SetStateAction<FramePreset[]>>;
  setMemoryEnabled: Dispatch<SetStateAction<boolean>>;
  setNotice: (text: string) => void;
  setPendingInvitations: Dispatch<SetStateAction<CreationSessionInvitation[]>>;
  setServerTemplates: Dispatch<SetStateAction<ServerCreationTemplate[]>>;
  setSessionMode_: Dispatch<SetStateAction<'chat' | 'work'>>;
  shareOpen: boolean;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  templateOpen: boolean;
}

export function useCanvasSessionModes({ autoApplyRef, nodes, persistence, sessionId, sessionRole, setAutoApply, setDatasetRowLimit, setFramePresets, setMemoryEnabled, setNotice, setPendingInvitations, setServerTemplates, setSessionMode_, shareOpen, t, templateOpen }: UseCanvasSessionModesDeps) {
  const setAutoApplyMode = useCallback((enabled: boolean) => {
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
    setBrainAutoApprove(enabled);
  }, []);

  /**
   * Session MODE (migration 0409) — `chat` (author on the board and answer) or `work`
   * (leave a tracked, dispatched ticket behind). Persisted on the SESSION rather than
   * in this browser, so a mode a collaborator armed is the mode everyone's next turn
   * runs in. A local (unsaved) canvas has nowhere to persist it, so it keeps the value
   * in state only — the same degradation the rest of the local canvas accepts.
   */
  const setSessionMode = useCallback((next: ChatMode) => {
    setSessionMode_(next);
    if (persistence !== 'server') {
      // No server row to hold it, so the local snapshot does — otherwise the mode
      // reset on every reload of a guest canvas.
      const prior = readLocalCreationSession(sessionId);
      if (prior) writeLocalCreationSession(sessionId, { ...prior, mode: next, updatedAt: new Date().toISOString() });
      return;
    }
    void creationSessionsApi.update(sessionId, { mode: next })
      .catch(() => setNotice(t('modeSaveFailed')));
  }, [persistence, sessionId, t]);

  const memoryStorageKey = useMemo(() => {
    const chat = nodes.find((node) => node.data.kind === 'chat');
    const canonicalId = chat?.data.resourceId?.match(/^chat:(\d+)$/)?.[1];
    return `brain.memoryEnabled:${canonicalId || `canvas:${sessionId}`}`;
  }, [nodes, sessionId]);

  useEffect(() => {
    try { setMemoryEnabled(localStorage.getItem(memoryStorageKey) !== '0'); } catch { setMemoryEnabled(true); }
  }, [memoryStorageKey]);

  const setMemoryMode = useCallback((enabled: boolean) => {
    setMemoryEnabled(enabled);
    try { localStorage.setItem(memoryStorageKey, enabled ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }, [memoryStorageKey]);

  useEffect(() => {
    try { setFramePresets(JSON.parse(localStorage.getItem('builderforce:create-frame-presets') || '[]') as FramePreset[]); } catch { setFramePresets([]); }
  }, []);

  useEffect(() => {
    if (persistence !== 'server') return;
    void creationSessionsApi.quotas().then((quota) => {
      if (quota.limits.datasetRows === -1) setDatasetRowLimit(1_000_000);
      else setDatasetRowLimit(Math.max(1, quota.limits.datasetRows));
    }).catch(() => undefined);
  }, [persistence]);

  useEffect(() => {
    if (!templateOpen || persistence !== 'server') return;
    void creationSessionsApi.templates.list().then((result) => setServerTemplates(result.templates)).catch(() => setServerTemplates([]));
  }, [persistence, templateOpen]);

  useEffect(() => {
    if (!shareOpen || persistence !== 'server' || sessionRole !== 'owner') return;
    void creationSessionsApi.invitations.list(sessionId)
      .then((result) => setPendingInvitations(result.invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)))
      .catch((error) => setNotice(faultText(error, t('noticeInvitationsFailed'))));
  }, [persistence, sessionId, sessionRole, shareOpen]);
  return { setAutoApplyMode, setSessionMode, setMemoryMode };
}
