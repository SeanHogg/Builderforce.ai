import { describe, expect, it } from 'vitest';
import { buildBrowserCreativeArtifact, buildWebsiteAssets, creationDeliverables, withCreationDeliverable } from './creationDeliverables';

describe('creation deliverables', () => {
  it('builds a complete escaped static website instead of a status-only publish request', () => {
    const assets = buildWebsiteAssets({ kind: 'website', title: '<Launch>', websiteHeadline: 'Ship & learn', websiteBody: 'Real delivery', websiteCta: 'Open', websiteAccent: '#123456' });
    expect(assets.map((asset) => asset.path)).toEqual(['index.html', 'styles.css']);
    const html = new TextDecoder().decode(assets[0]!.data);
    expect(html).toContain('&lt;Launch&gt;');
    expect(html).toContain('Ship &amp; learn');
    expect(html).not.toContain('<Launch>');
  });

  it('replaces an in-flight manifest entry with its terminal result', () => {
    const started = { id: 'delivery-1', action: 'publish', artifactKind: 'website', status: 'running' as const, createdAt: '2026-08-04T00:00:00.000Z' };
    const completed = { ...started, status: 'delivered' as const, completedAt: '2026-08-04T00:00:01.000Z', url: 'https://example.test' };
    const first = withCreationDeliverable({ kind: 'website', title: 'Site' }, started);
    const second = withCreationDeliverable({ kind: 'website', title: 'Site', deliverables: first }, completed);
    expect(second).toHaveLength(1);
    expect(creationDeliverables({ kind: 'website', title: 'Site', deliverables: second })[0]).toMatchObject({ status: 'delivered', url: 'https://example.test' });
  });

  it.each([
    ['image', 'image/svg+xml', '.svg'], ['animation', 'text/html', '.html'], ['podcast', 'text/markdown', '.md'],
    ['comic', 'image/svg+xml', '.svg'], ['game', 'text/html', '.html'], ['cad', 'application/dxf', '.dxf'],
    ['model3d', 'model/stl', '.stl'], ['resume', 'text/markdown', '.md'], ['template', 'application/json', '.json'],
  ] as const)('creates a real portable %s artifact', (kind, mimeType, extension) => {
    const artifact = buildBrowserCreativeArtifact({ kind, title: 'Launch artifact', prompt: '<unsafe> brief' });
    expect(artifact.mimeType).toBe(mimeType);
    expect(artifact.fileName).toMatch(new RegExp(`\\${extension}$`));
    expect(artifact.url).toMatch(/^data:/);
  });
});
