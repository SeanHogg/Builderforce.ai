import { describe, expect, it, vi } from 'vitest';
import type { SecurityEvent } from '@seanhogg/builderforce-webcontainers';
import type { ShieldIncidentReport } from './runtimeSecurityApi';
import { createShieldSink, SHIELD_BATCH_DELAY_MS, SHIELD_BATCH_MAX, SHIELD_DEDUPE_WINDOW_MS, shieldId, shieldReportOf } from './shieldSink';

vi.mock('@/lib/reportError', () => ({ recordedFailure: () => () => undefined }));
vi.mock('./runtimeSecurityApi', () => ({ runtimeSecurityApi: { reportShieldIncident: vi.fn() } }));

const event = (overrides: Partial<SecurityEvent> = {}): SecurityEvent => ({
  category: 'network',
  ruleId: 'network.port-ownership',
  severity: 'medium',
  reasonCode: 'port.not_owner',
  action: 'reject',
  context: { applicationId: 'app:42:0123456789abcdef', serviceId: 'api' },
  evidence: { port: 5432 },
  occurredAt: Date.UTC(2026, 10, 18, 12),
  ...overrides,
} as SecurityEvent);

function harness(projectId: string | null = '42') {
  let clock = 1_000_000;
  const sent: ShieldIncidentReport[] = [];
  const pending: Array<() => void> = [];
  const report = vi.fn(async (body: ShieldIncidentReport) => { sent.push(body); });
  const sink = createShieldSink({
    projectId: () => projectId,
    report,
    now: () => clock,
    schedule: (flush, ms) => { expect(ms).toBe(SHIELD_BATCH_DELAY_MS); pending.push(flush); },
  });
  const flush = () => { for (const run of pending.splice(0)) run(); };
  return { sink, sent, report, flush, advance: (ms: number) => { clock += ms; } };
}

describe('shieldReportOf', () => {
  it("maps an event onto the API's body, with ids the API accepts", () => {
    expect(shieldReportOf(event(), null)).toEqual({
      category: 'network',
      ruleId: 'network.port-ownership',
      severity: 'medium',
      reasonCode: 'port.not_owner',
      action: 'reject',
      applicationId: 'app.42.0123456789abcdef',
      serviceId: 'api',
      projectId: 42,
      evidence: { port: 5432 },
      occurredAt: '2026-11-18T12:00:00.000Z',
    });
  });

  it("falls back to the runtime's project for events no application owns, and drops what it cannot attribute", () => {
    const workspace = event({ context: { applicationId: 'workspace', serviceId: 'unattributed' } });
    expect(shieldReportOf(workspace, '7')?.projectId).toBe(7);
    expect(shieldReportOf(workspace, null)).toBeNull();
    expect(shieldReportOf(workspace, 'workspace')).toBeNull();
  });

  it('keeps ids inside the API alphabet and length', () => {
    expect(shieldId('a b:c')).toBe('a_b.c');
    expect(shieldId('x'.repeat(200))).toHaveLength(128);
    expect(shieldId('')).toBe('unattributed');
  });
});

describe('createShieldSink', () => {
  it('reports only events that stopped something', () => {
    const { sink, sent, flush } = harness();
    for (const action of ['allow', 'monitor', 'throttle'] as const) sink.emit(event({ action }));
    sink.emit(event({ action: 'quarantine', reasonCode: 'fs.outside_app' }));
    sink.emit(event());
    flush();
    expect(sent.map((r) => r.action)).toEqual(['quarantine', 'reject']);
  });

  it('deduplicates per (reason code, application) per minute', () => {
    const { sink, sent, flush, advance } = harness();
    sink.emit(event());
    sink.emit(event());
    sink.emit(event({ context: { applicationId: 'app:42:ffffffffffffffff', serviceId: 'api' } }));
    sink.emit(event({ reasonCode: 'db.not_owner' }));
    flush();
    expect(sent).toHaveLength(3);
    advance(SHIELD_DEDUPE_WINDOW_MS - 1);
    sink.emit(event());
    flush();
    expect(sent).toHaveLength(3);
    advance(1);
    sink.emit(event());
    flush();
    expect(sent).toHaveLength(4);
  });

  it('batches: one scheduled flush per batch, bounded', () => {
    const { sink, sent, flush } = harness();
    for (let i = 0; i < SHIELD_BATCH_MAX + 5; i++) {
      sink.emit(event({ context: { applicationId: `app:42:${i.toString(16).padStart(16, '0')}`, serviceId: 'api' } }));
    }
    flush();
    expect(sent).toHaveLength(SHIELD_BATCH_MAX);
  });

  it('never throws: a failing report or a malformed event is swallowed', async () => {
    const sink = createShieldSink({
      projectId: () => '42',
      report: () => Promise.reject(new Error('offline')),
      schedule: (flush) => flush(),
    });
    expect(() => sink.emit(event())).not.toThrow();
    expect(() => sink.emit({ action: 'reject' } as unknown as SecurityEvent)).not.toThrow();
    await Promise.resolve();
  });
});
