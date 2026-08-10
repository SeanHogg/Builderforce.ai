import { describe, expect, it } from 'vitest';
import {
  creationKindForModality,
  durableCreationGraph,
  creationObjectSearchText,
  creationSessionSearchStatus,
  isCreationEventWriteConflict,
  validCreationGraph,
} from './creationSessionRouteService';

describe('creationKindForModality', () => {
  it('keeps every IDE modality attached to the Builder workspace', () => {
    for (const modality of ['designer', 'mobile', 'webmobile', 'video', 'evermind', 'llm', 'finetune', 'voice', 'unknown']) {
      expect(creationKindForModality(modality)).toBe('build');
    }
  });
});

describe('creationObjectSearchText', () => {
  it('indexes only the explicit display fields', () => {
    expect(creationObjectSearchText({
      title: 'Campaign plan',
      subtitle: 'Fall launch',
      status: 'Draft',
      label: 'Marketing',
      prompt: 'private prompt',
      secret: 'sk-not-indexed',
      rows: [{ customer: 'Ada Lovelace' }],
    })).toBe('Campaign plan Fall launch Draft Marketing');
  });

  it('normalizes whitespace and ignores non-string values', () => {
    expect(creationObjectSearchText({ title: '  Sales\n roadmap ', status: 2 })).toBe('Sales roadmap');
    expect(creationObjectSearchText(null)).toBe('');
    expect(creationObjectSearchText(['not', 'an', 'object'])).toBe('');
  });
});

describe('creationSessionSearchStatus', () => {
  it('excludes archived sessions unless explicitly requested', () => {
    expect(creationSessionSearchStatus(undefined)).toBe('active');
    expect(creationSessionSearchStatus('deleted')).toBe('active');
    expect(creationSessionSearchStatus('archived')).toBe('archived');
    expect(creationSessionSearchStatus('all')).toBe('all');
  });
});

describe('isCreationEventWriteConflict', () => {
  it('recognizes deployed and current revision constraint names', () => {
    expect(isCreationEventWriteConflict(new Error(
      'duplicate key value violates unique constraint "creation_session_events_session_id_revision_key"',
    ))).toBe(true);
    expect(isCreationEventWriteConflict({ code: '23505', constraint: 'uq_creation_events_revision' })).toBe(true);
  });

  it('recognizes an idempotency-key race but not unrelated unique failures', () => {
    expect(isCreationEventWriteConflict({ code: '23505', constraint: 'uq_creation_events_idempotency' })).toBe(true);
    expect(isCreationEventWriteConflict({ code: '23505', constraint: 'creation_session_objects_pkey' })).toBe(false);
    expect(isCreationEventWriteConflict(new Error('connection reset'))).toBe(false);
  });
});

describe('validCreationGraph', () => {
  const objects = [
    { id: '00000000-0000-4000-8000-000000000001', kind: 'dataset', canvasData: {}, content: {} },
    { id: '00000000-0000-4000-8000-000000000002', kind: 'chart', canvasData: {}, content: {} },
  ];

  it('accepts the six semantic connection kinds', () => {
    for (const kind of ['data', 'control', 'reference', 'presentation', 'delivery', 'membership']) {
      expect(validCreationGraph(objects, [{ id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: objects[1]!.id, kind }])).toBeNull();
    }
  });

  it('rejects renderer and action labels as connection semantics', () => {
    expect(validCreationGraph(objects, [{ id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: objects[1]!.id, kind: 'smoothstep' }])).toMatch(/connection kind/i);
    expect(validCreationGraph(objects, [{ id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: objects[1]!.id, kind: 'publishes' }])).toMatch(/connection kind/i);
  });

  it('rejects forged object kinds and references outside the session', () => {
    expect(validCreationGraph([{ ...objects[0]!, kind: 'admin-secret' }], [])).toMatch(/object kind/i);
    expect(validCreationGraph(objects, [{ id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: crypto.randomUUID(), kind: 'reference' }])).toMatch(/outside this session/i);
  });

  it('rejects duplicate object and connection identifiers', () => {
    expect(validCreationGraph([objects[0]!, { ...objects[1]!, id: objects[0]!.id }], [])).toMatch(/duplicate object/i);
    const edge = { id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: objects[1]!.id, kind: 'data' };
    expect(validCreationGraph(objects, [edge, edge])).toMatch(/duplicate connection/i);
  });

  it('enforces graph size limits before persistence', () => {
    const tooManyObjects = Array.from({ length: 1_001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      kind: 'note', canvasData: {}, content: {},
    }));
    expect(validCreationGraph(tooManyObjects, [])).toMatch(/at most 1,000 objects/i);
    expect(validCreationGraph(objects, Array.from({ length: 4_001 }, () => ({
      id: crypto.randomUUID(), sourceObjectId: objects[0]!.id, targetObjectId: objects[1]!.id, kind: 'reference',
    })))).toMatch(/at most 4,000 connections/i);
  });
});

describe('durableCreationGraph', () => {
  it('rekeys claimed objects and preserves connection topology', () => {
    const objects = [
      { id: '00000000-0000-4000-8000-000000000001', kind: 'dataset' },
      { id: '00000000-0000-4000-8000-000000000002', kind: 'chart' },
    ];
    const connections = [{
      id: '00000000-0000-4000-8000-000000000003',
      sourceObjectId: objects[0]!.id,
      targetObjectId: objects[1]!.id,
      kind: 'data',
    }];
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ];

    const durable = durableCreationGraph(objects, connections, () => ids.shift()!);

    expect(durable.objects.map((object) => object.id)).toEqual([
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
    ]);
    expect(durable.connections).toEqual([expect.objectContaining({
      id: '10000000-0000-4000-8000-000000000003',
      sourceObjectId: '10000000-0000-4000-8000-000000000001',
      targetObjectId: '10000000-0000-4000-8000-000000000002',
    })]);
    expect(objects[0]!.id).toBe('00000000-0000-4000-8000-000000000001');
  });
});
