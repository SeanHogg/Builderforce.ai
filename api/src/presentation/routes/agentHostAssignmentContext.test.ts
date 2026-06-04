import { describe, expect, it } from 'vitest';
import { classifyContextFiles, normalizeMachineProfile } from './agentHostAssignmentContext';

describe('normalizeMachineProfile', () => {
  it('keeps valid metadata and strips invalid fields', () => {
    const profile = normalizeMachineProfile({
      machineName: 'DevBox',
      machineIp: '10.0.0.5',
      rootInstallDirectory: '/opt/builderforce-agents',
      workspaceDirectory: '/work/app',
      gatewayPort: 18789,
      relayPort: 18790,
      tunnelUrl: 'https://abc.ngrok.io',
      tunnelStatus: 'connected',
      networkMetadata: { localIps: ['10.0.0.5'] },
      ignored: true,
    });

    expect(profile).toEqual({
      machineName: 'DevBox',
      machineIp: '10.0.0.5',
      rootInstallDirectory: '/opt/builderforce-agents',
      workspaceDirectory: '/work/app',
      gatewayPort: 18789,
      relayPort: 18790,
      tunnelUrl: 'https://abc.ngrok.io',
      tunnelStatus: 'connected',
      networkMetadata: { localIps: ['10.0.0.5'] },
    });
  });

  it('returns null when no valid fields are provided', () => {
    expect(normalizeMachineProfile({ gatewayPort: 0, relayPort: 99999 })).toBeNull();
    expect(normalizeMachineProfile('invalid')).toBeNull();
  });
});

describe('classifyContextFiles', () => {
  it('classifies manifest, prd, task, and memory files', () => {
    const result = classifyContextFiles([
      '.builderforce/manifest.yaml',
      'docs/prds/checkout.md',
      '.builderforce/tasks/backlog.md',
      '.builderforce/memory/decisions.md',
      '.builderforce/sessions/2026-03-15.yaml',
      'README.md',
    ]);

    expect(result.manifestFiles).toContain('.builderforce/manifest.yaml');
    expect(result.prdFiles).toContain('docs/prds/checkout.md');
    expect(result.taskFiles).toContain('.builderforce/tasks/backlog.md');
    expect(result.memoryFiles).toEqual(
      expect.arrayContaining([
        '.builderforce/memory/decisions.md',
        '.builderforce/sessions/2026-03-15.yaml',
      ]),
    );
  });
});
