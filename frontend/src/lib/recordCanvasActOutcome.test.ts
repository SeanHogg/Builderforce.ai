import { describe, expect, it } from 'vitest';
import { CONNECTED_CANVAS_ACTIONS } from '@/domains/canvas/domain/canvasChange';
import { CARD_ACTS } from '@/domains/canvas/application/cardActs';
import { cardActFor } from '@/domains/canvas/application/CardAct';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import { canvasActOutcomeBodies } from './recordCanvasActOutcome';

describe('canvasActOutcomeBodies', () => {
  it('emits started then a terminal, same correlationId, for every mapped event', () => {
    const bodies = canvasActOutcomeBodies({
      sessionId: 'ses-1',
      kind: 'invoice',
      action: 'issue',
      objectId: 'inv-1',
      patch: { status: 'issued' },
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      correlationId: 'act:inv-1:invoice.issue',
      action: 'invoice.issue',
      phase: 'started',
      artifactId: 'inv-1',
    });
    expect(bodies[1]).toMatchObject({
      correlationId: 'act:inv-1:invoice.issue',
      action: 'invoice.issue',
      phase: 'succeeded',
      artifactId: 'inv-1',
    });
  });

  it('marks a published form reachable from its joinUrl', () => {
    const bodies = canvasActOutcomeBodies({
      sessionId: 'ses-1',
      kind: 'form',
      action: 'publish',
      objectId: 'form-1',
      patch: { joinUrl: 'https://app.example/f/abc' },
    });
    const actions = bodies.map((body) => `${body.action}:${body.phase}`);
    expect(actions).toEqual([
      'artifact.publish:started',
      'artifact.publish:succeeded',
      'proof.build:started',
      'proof.build:succeeded',
    ]);
    for (const body of bodies) {
      expect(body.correlationId).toBe('act:form-1:form.publish');
      expect(body.metadata).toMatchObject({
        kind: 'form',
        canvasAction: 'publish',
        url: 'https://app.example/f/abc',
        reachable: true,
      });
    }
  });

  it('the cheap idea path produces the four proof-lifecycle actions', () => {
    const explore = canvasActOutcomeBodies({ sessionId: 's', kind: 'idea', action: 'explore', objectId: 'i1' });
    const test = canvasActOutcomeBodies({ sessionId: 's', kind: 'idea', action: 'test', objectId: 'i1' });
    const publish = canvasActOutcomeBodies({
      sessionId: 's', kind: 'form', action: 'publish', objectId: 'f1',
      patch: { joinUrl: 'https://app.example/f/x' },
    });
    const reveal = canvasActOutcomeBodies({
      sessionId: 's', kind: 'idea', action: 'reveal', objectId: 'i1',
      extra: { metricKey: 'proof.grade', metricValue: 1 },
    });
    const actions = [...explore, ...test, ...publish, ...reveal]
      .filter((body) => body.phase !== 'started')
      .map((body) => body.action);
    expect(actions).toEqual([
      'idea.read',
      'proof.choose',
      'artifact.publish',
      'proof.build',
      'proof.grade',
    ]);
    expect(reveal[1]).toMatchObject({ phase: 'validated', metricValue: 1 });
  });

  it('marks a published poll reachable from its joinUrl', () => {
    const bodies = canvasActOutcomeBodies({
      sessionId: 'ses-1',
      kind: 'poll',
      action: 'publish',
      objectId: 'poll-1',
      patch: { joinUrl: '/p/abc' },
    });
    expect(bodies.map((body) => `${body.action}:${body.phase}`)).toEqual([
      'artifact.publish:started',
      'artifact.publish:succeeded',
      'proof.build:started',
      'proof.build:succeeded',
    ]);
    expect(bodies[0].metadata).toMatchObject({
      kind: 'poll',
      canvasAction: 'publish',
      url: '/p/abc',
      reachable: true,
    });
  });

  it('a missed grade still validates with metricValue 0', () => {
    const bodies = canvasActOutcomeBodies({
      sessionId: 's',
      kind: 'idea',
      action: 'reveal',
      objectId: 'i1',
      extra: { metricKey: 'proof.grade', metricValue: 0 },
    });
    expect(bodies[1]).toMatchObject({ action: 'proof.grade', phase: 'validated', metricValue: 0 });
  });
});

describe('connected cheap-proof acts have adapters', () => {
  it('idea CONNECTED acts resolve to a card act', () => {
    for (const action of CONNECTED_CANVAS_ACTIONS.idea ?? []) {
      expect(cardActFor(CARD_ACTS, 'idea' as CreationObjectKind, action), `idea.${action}`).toBeTruthy();
    }
  });

  it('form publish/collect/close resolve to a card act', () => {
    for (const action of ['publish', 'collect', 'close'] as const) {
      expect(cardActFor(CARD_ACTS, 'form' as CreationObjectKind, action), `form.${action}`).toBeTruthy();
    }
  });
});
