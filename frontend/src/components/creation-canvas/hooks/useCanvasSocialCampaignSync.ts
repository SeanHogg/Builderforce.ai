import { type Dispatch, type SetStateAction, useCallback } from 'react';
import type { useTranslations } from 'next-intl';
import { syncSocialCampaign as syncCampaignUseCase } from '@/domains/marketing/application/SyncSocialCampaign';
import { socialCampaignGateway } from '@/domains/marketing/infrastructure/socialCampaignGateway';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import { socialCampaignNodeData } from '@/lib/canvasSocial';
import type { CreationFlowNode } from '../CreationNode';
import type { CreationNodeData } from '../types';

export interface UseCanvasSocialCampaignSyncDeps {
  setNodes: Dispatch<SetStateAction<CreationFlowNode[]>>;
  setNotice: (text: string) => void;
  tSocial: ReturnType<typeof useTranslations<'creationCanvas.social'>>;
}

/**
 * A social campaign's copy lives on the SERVER, not on the tile.
 *
 * The tile is a view of a saved campaign, and publishing reads the saved copy — so an
 * edit that stopped at the card would show one message on the board and publish a
 * different one. Editing these fields therefore writes through, and the returned
 * campaign (whose blockers and target count may have changed) is what lands back on
 * the tile. Everything else about a campaign object is a read-only reflection.
 */
export function useCanvasSocialCampaignSync({ setNodes, setNotice, tSocial }: UseCanvasSocialCampaignSyncDeps) {
  return useCallback(async (campaignId: number, nodeId: string, patch: Partial<CreationNodeData>) => {
    // WHICH fields of an edited card may be sent — and why an untouched
    // `scheduledAt` must not be one of them — is the marketing context's rule.
    const result = await syncCampaignUseCase(campaignId, patch, socialCampaignGateway, tSocial as CanvasTextTranslator);
    if (!result.ok) { setNotice(result.notice); return; }
    setNodes((current) => current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...socialCampaignNodeData(result.campaign) } as CreationNodeData }
      : node));
  }, [setNodes, setNotice, tSocial]);
}
