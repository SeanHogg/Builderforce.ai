import { describe, expect, it } from 'vitest';
import { createLocalAuditFinding } from './localAudit.js';
import type { EntityDestination } from './records.js';
import { createMemoryLocalFirstStore } from './store.js';

const DEVICE = 'device-1';
const AT = '2026-10-19T00:00:00.000Z';

describe('local audit findings', () => {
  it('writes an audit-finding record and a create journal event with no network', async () => {
    const store = createMemoryLocalFirstStore();
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: unknown) => {
      calls.push(String(input));
      throw new Error('network_denied');
    }) as typeof fetch;

    const destination: EntityDestination = {
      kind: 'bound',
      accountId: 'acct-1',
      tenantId: 'tenant-a',
      projectId: 'project-1',
    };

    try {
      const saved = await createLocalAuditFinding(store, {
        id: 'finding-1',
        title: 'Missing local close',
        auditRunId: 'run-1',
        fingerprint: 'fp-close',
        severity: 'high',
        evidence: { location: 'auditExecution.ts' },
        deviceId: DEVICE,
        destination,
        occurredAt: AT,
        dependsOn: ['audit-run:run-1:v1'],
      });
      expect(saved.entityType).toBe('audit-finding');
      expect(saved.id).toBe('finding-1');
      expect(saved.payload).toEqual({
        auditRunId: 'run-1',
        fingerprint: 'fp-close',
        severity: 'high',
        summary: 'Missing local close',
        evidence: { location: 'auditExecution.ts' },
      });
      expect(saved.provenance?.deviceId).toBe(DEVICE);
      expect(saved.destination).toEqual(destination);
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
    const snapshot = await store.export();
    expect(snapshot.records).toEqual([
      expect.objectContaining({
        id: 'finding-1',
        entityType: 'audit-finding',
        payload: {
          auditRunId: 'run-1',
          fingerprint: 'fp-close',
          severity: 'high',
          summary: 'Missing local close',
          evidence: { location: 'auditExecution.ts' },
        },
      }),
    ]);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        clientEntityId: 'finding-1',
        entityType: 'audit-finding',
        operation: 'create',
        occurredAt: AT,
        dependsOn: ['audit-run:run-1:v1'],
      }),
    ]);
  });

  it('throws audit_finding_title_required and writes nothing when the title is empty', async () => {
    const store = createMemoryLocalFirstStore();
    const before = await store.export();

    await expect(createLocalAuditFinding(store, {
      id: 'finding-empty',
      title: '',
      auditRunId: 'run-1',
      deviceId: DEVICE,
      occurredAt: AT,
    })).rejects.toThrow('audit_finding_title_required');

    await expect(createLocalAuditFinding(store, {
      id: 'finding-blank',
      title: '   ',
      auditRunId: 'run-1',
      deviceId: DEVICE,
      occurredAt: AT,
    })).rejects.toThrow('audit_finding_title_required');

    expect(await store.export()).toEqual(before);
  });
});
