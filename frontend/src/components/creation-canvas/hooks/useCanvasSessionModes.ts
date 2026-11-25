/** Auto-apply and chat/work mode. The Memory switch is `useCanvasMemorySwitch`'s. */
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect } from 'react';
import { setBrainAutoApprove } from '@/lib/brain/autoApprove';
import type { ChatMode } from '@/lib/brain';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { updateLocalCreationSession } from '@/lib/pendingWork';
import { type CreationSessionInvitation, creationSessionsApi, type CreationTemplate as ServerCreationTemplate } from '@/lib/builderforceApi';
import type { FramePreset } from '../canvasBoardTypes';
import { faultText } from '@/lib/apiClient';
import type { useTranslations } from 'next-intl';

export interface UseCanvasSessionModesDeps {
  autoApplyRef: RefObject<boolean>;
  persistence: 'local' | 'server';
  sessionId: string;
  sessionRole: 'viewer' | 'commenter' | 'editor' | 'runner' | 'owner';
  setAutoApply: Dispatch<SetStateAction<boolean>>;
  setDatasetRowLimit: Dispatch<SetStateAction<number>>;
  setFramePresets: Dispatch<SetStateAction<FramePreset[]>>;
  setNotice: (text: string) => void;
  setPendingInvitations: Dispatch<SetStateAction<CreationSessionInvitation[]>>;
  setServerTemplates: Dispatch<SetStateAction<ServerCreationTemplate[]>>;
  setSessionMode_: Dispatch<SetStateAction<'chat' | 'work'>>;
  shareOpen: boolean;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
  templateOpen: boolean;
}

export function useCanvasSessionModes({ autoApplyRef, persistence, sessionId, sessionRole, setAutoApply, setDatasetRowLimit, setFramePresets, setNotice, setPendingInvitations, setServerTemplates, setSessionMode_, shareOpen, t, templateOpen }: UseCanvasSessionModesDeps) {
  const setAutoApplyMode = useCallback((enabled: boolean) => {
    autoApplyRef.current = enabled;
    setAutoApply(enabled);
    setBrainAutoApprove(enabled);
  }, [autoApplyRef, setAutoApply]);

  /**
   * Session MODE (migration 0409) — `chat` (author on the board and answer) or `work`
   * (leave a tracked, dispatched ticket behind). Persisted on the BOARD, so a mode a
   * collaborator armed is the mode everyone's next turn runs in: the header write is
   * journaled like any other edit and the server importer applies it, so a guest's canvas
   * and a workspace's keep it the same way and neither loses it on a reload or offline.
   */
  const setSessionMode = useCallback((next: ChatMode) => {
    setSessionMode_(next);
    void updateLocalCreationSession(sessionId, { mode: next })
      .catch((error: unknown) => { reportLocalFirstFailure('canvasMode', error); setNotice(t('modeSaveFailed')); });
  }, [sessionId, setNotice, setSessionMode_, t]);

  useEffect(() => {
    try { setFramePresets(JSON.parse(localStorage.getItem('builderforce:create-frame-presets') || '[]') as FramePreset[]); } catch { setFramePresets([]); }
  }, [setFramePresets]);

  useEffect(() => {
    if (persistence !== 'server') return;
    void creationSessionsApi.quotas().then((quota) => {
      if (quota.limits.datasetRows === -1) setDatasetRowLimit(1_000_000);
      else setDatasetRowLimit(Math.max(1, quota.limits.datasetRows));
    }).catch(() => undefined);
  }, [persistence, setDatasetRowLimit]);

  useEffect(() => {
    if (!templateOpen || persistence !== 'server') return;
    void creationSessionsApi.templates.list().then((result) => setServerTemplates(result.templates)).catch(() => setServerTemplates([]));
  }, [persistence, setServerTemplates, templateOpen]);

  useEffect(() => {
    if (!shareOpen || persistence !== 'server' || sessionRole !== 'owner') return;
    void creationSessionsApi.invitations.list(sessionId)
      .then((result) => setPendingInvitations(result.invitations.filter((invitation) => !invitation.acceptedAt && !invitation.revokedAt)))
      .catch((error) => setNotice(faultText(error, t('noticeInvitationsFailed'))));
  }, [persistence, sessionId, sessionRole, setNotice, setPendingInvitations, shareOpen, t]);
  return { setAutoApplyMode, setSessionMode };
}
