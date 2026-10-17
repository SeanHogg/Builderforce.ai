import { describe, expect, it } from 'vitest';
import { eventsOf } from '../../application/agentHost/hostTelemetryIngest';
import { FileChangeIngestBody, ToolAuditIngestBody } from './agentHostRoutes.schemas';

/** The wire contract: older hosts post one event, the relay DO and newer runtimes batch. */
describe('host telemetry wire shapes', () => {
  it('accepts the single-event body every host in the field sends', () => {
    const body = ToolAuditIngestBody.parse({ toolName: 'read_file', executionId: '42', type: 'tool.audit' });
    expect(eventsOf(body)).toEqual({ events: [{ toolName: 'read_file', executionId: '42' }], single: true });
  });

  it('accepts a batch and drops only its malformed events', () => {
    const body = ToolAuditIngestBody.parse({ events: [{ toolName: 'a' }, { toolName: 5 }, { toolName: 'b' }] });
    expect(eventsOf(body)).toEqual({ events: [{ toolName: 'a' }, { toolName: 'b' }], single: false });
  });

  it('an empty file-change body is still one (invalid) event', () => {
    expect(eventsOf(FileChangeIngestBody.parse({})).single).toBe(true);
  });
});
