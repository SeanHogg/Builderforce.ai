import { describe, expect, it } from 'vitest';
import { appDeploymentChange, appDeploymentNode } from './appDeployment';
import { isLiveDeployment } from './boardDeployments';

const NOW = '2026-10-05T12:00:00.000Z';
const context = { now: NOW, title: 'Yard app — live' };
const app = { id: 'app', data: { kind: 'build', title: 'Yard app' } };
const card = (id: string, extra: Record<string, unknown> = {}) => ({ id, data: { kind: 'deployment', title: 'Prod', ...extra } });

describe('appDeploymentChange', () => {
  it('creates a LIVE deployment card for an app with none', () => {
    const change = appDeploymentChange([app], [], 'app', { url: ' https://yard.builderforce.app ', versionToken: 'v7' }, context);
    expect(change).toEqual({
      type: 'create',
      data: { kind: 'deployment', title: 'Yard app — live', url: 'https://yard.builderforce.app', environmentName: 'production', deployedAt: NOW, status: 'live', version: 'v7' },
    });
    // The card it makes is exactly what readiness, Operate and the room call live.
    expect(isLiveDeployment((change as { data: Record<string, unknown> }).data)).toBe(true);
  });

  it('keeps the site’s own publish time when it has one', () => {
    const change = appDeploymentChange([app], [], 'app', { url: 'https://a.example', publishedAt: '2026-09-01T00:00:00Z' }, context);
    expect(change).toMatchObject({ type: 'create', data: { deployedAt: '2026-09-01T00:00:00Z' } });
  });

  it('updates the app’s OWN card on a re-publish — one card per app, not one per push', () => {
    const nodes = [app, card('d1', { url: 'https://a.example', version: 'v1' }), card('other', { url: 'https://elsewhere.example' })];
    const change = appDeploymentChange(nodes, [{ source: 'app', target: 'd1' }], 'app', { url: 'https://a.example', versionToken: 'v2' }, context);
    expect(change).toEqual({ type: 'update', deploymentId: 'd1', patch: { url: 'https://a.example', environmentName: 'production', deployedAt: NOW, status: 'live', version: 'v2' } });
  });

  it('finds the card connected either way round', () => {
    const nodes = [app, card('d1')];
    expect(appDeploymentNode(nodes, [{ source: 'd1', target: 'app' }], 'app')?.id).toBe('d1');
  });

  it('ignores a deployment card that belongs to nothing', () => {
    const change = appDeploymentChange([app, card('loose', { url: 'https://a.example' })], [], 'app', { url: 'https://a.example' }, context);
    expect(change?.type).toBe('create');
  });

  it('writes nothing when the board already says exactly this', () => {
    const nodes = [app, card('d1', { url: 'https://a.example', version: 'v2' })];
    const edges = [{ source: 'app', target: 'd1' }];
    expect(appDeploymentChange(nodes, edges, 'app', { url: 'https://a.example', versionToken: 'v2' }, context)).toBeNull();
    expect(appDeploymentChange(nodes, edges, 'app', { url: 'https://a.example' }, context)).toBeNull();
  });

  it('records nothing for a site with no address', () => {
    expect(appDeploymentChange([app], [], 'app', { url: '   ' }, context)).toBeNull();
  });
});
