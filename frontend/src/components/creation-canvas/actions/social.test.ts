import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialPublishBatch } from '@/lib/socialApi';

const mocks = vi.hoisted(() => ({
  publishCampaign: vi.fn(),
  recordCanvasActOutcomes: vi.fn(),
}));

vi.mock('@/lib/socialApi', () => ({
  socialApi: { publishCampaign: mocks.publishCampaign },
}));
vi.mock('@/lib/recordCanvasActOutcome', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/recordCanvasActOutcome')>();
  return { ...actual, recordCanvasActOutcomes: mocks.recordCanvasActOutcomes };
});

import type { CanvasActionContext } from './context';
import { canvasSocialActions } from './social';
import { canvasActOutcomeBodies } from '@/lib/recordCanvasActOutcome';

const BATCH: SocialPublishBatch = {
  campaignId: 42,
  published: 1,
  failed: 0,
  skipped: 0,
  uploading: 0,
  remaining: 0,
  status: 'published',
  results: [],
  campaign: null,
};

function campaignNode(id = 'sc-1', campaignId: unknown = 42) {
  return { id, data: { kind: 'socialCampaign', title: 'Launch', campaignId } };
}

function harness(overrides: {
  canEdit?: boolean;
  persistence?: 'local' | 'server';
  sessionId?: string;
  gate?: { requiresAccount: true; tool: string; error: string } | null;
  nodes?: Array<{ id: string; data: Record<string, unknown> }>;
} = {}) {
  const ctx = {
    canEdit: overrides.canEdit ?? true,
    persistence: overrides.persistence ?? 'server',
    sessionId: overrides.sessionId ?? 'ses-1',
    socialAccountGate: vi.fn(() => overrides.gate ?? null),
    nodes: () => overrides.nodes ?? [campaignNode()],
    stage: { updateObject: vi.fn() },
    tSocial: (key: string) => key,
  } as unknown as CanvasActionContext;
  const actions = canvasSocialActions(ctx);
  const tool = (name: string) => actions.find((action) => action.name === name)!;
  return { ctx, tool };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.publishCampaign.mockResolvedValue(BATCH);
});

describe('canvas_publish_social_campaign', () => {
  it('records started then succeeded on one correlationId after a real publish', async () => {
    const { tool } = harness();
    const result = await tool('canvas_publish_social_campaign').run({ objectId: 'sc-1' });
    expect(result).toMatchObject({ ok: true, objectId: 'sc-1', published: 1 });
    expect(mocks.publishCampaign).toHaveBeenCalledWith(42);
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledTimes(1);
    expect(mocks.recordCanvasActOutcomes).toHaveBeenCalledWith({
      sessionId: 'ses-1',
      kind: 'socialCampaign',
      action: 'publish',
      objectId: 'sc-1',
    });
    const bodies = canvasActOutcomeBodies({
      sessionId: 'ses-1',
      kind: 'socialCampaign',
      action: 'publish',
      objectId: 'sc-1',
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      correlationId: 'act:sc-1:socialCampaign.publish',
      action: 'socialCampaign.publish',
      phase: 'started',
    });
    expect(bodies[1]).toMatchObject({
      correlationId: 'act:sc-1:socialCampaign.publish',
      action: 'socialCampaign.publish',
      phase: 'succeeded',
    });
    expect(bodies[0]!.correlationId).toBe(bodies[1]!.correlationId);
  });

  it('does not record when the account gate refuses', async () => {
    const { tool } = harness({
      gate: { requiresAccount: true, tool: 'canvas_publish_social_campaign', error: 'needs account' },
    });
    const result = await tool('canvas_publish_social_campaign').run({ objectId: 'sc-1' });
    expect(result).toMatchObject({ requiresAccount: true });
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record when the tile is not bound to a saved campaign', async () => {
    const { tool } = harness({ nodes: [campaignNode('sc-1', 'draft')] });
    const result = await tool('canvas_publish_social_campaign').run({ objectId: 'sc-1' });
    expect(result).toEqual({ error: 'That campaign tile is not bound to a saved campaign.' });
    expect(mocks.publishCampaign).not.toHaveBeenCalled();
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record a failed publish as a terminal outcome', async () => {
    mocks.publishCampaign.mockRejectedValue(new Error('network down'));
    const { tool } = harness();
    const result = await tool('canvas_publish_social_campaign').run({ objectId: 'sc-1' });
    expect(result).toEqual({ error: 'network down' });
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });

  it('does not record on an unsaved board', async () => {
    const { tool } = harness({ persistence: 'local', sessionId: 'local-abc' });
    const result = await tool('canvas_publish_social_campaign').run({ objectId: 'sc-1' });
    expect(result).toMatchObject({ ok: true });
    expect(mocks.publishCampaign).toHaveBeenCalledWith(42);
    expect(mocks.recordCanvasActOutcomes).not.toHaveBeenCalled();
  });
});
