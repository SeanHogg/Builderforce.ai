import { describe, expect, it } from 'vitest';
import { buildBrowserCreativeArtifact, buildWebsiteAssets, creationDeliverables, creativePreviewImageUrl, isDisplayableImageUrl, navigableArtifactUrl, withCreationDeliverable } from './creationDeliverables';

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

  it.each(['cad', 'model3d'] as const)('ships a rendered preview with the %s export, which is not itself an image', (kind) => {
    const artifact = buildBrowserCreativeArtifact({ kind, title: 'Bracket' });
    expect(isDisplayableImageUrl(artifact.url)).toBe(false);
    expect(artifact.previewImageUrl).toMatch(/^data:image\/svg\+xml/);
    expect(creativePreviewImageUrl({ kind, title: 'Bracket', outputUrl: artifact.url, thumbnailUrl: artifact.previewImageUrl })).toBe(artifact.previewImageUrl);
  });

  it('exports a closed twelve-facet solid rather than four floating facets', () => {
    const stl = decodeURIComponent(buildBrowserCreativeArtifact({ kind: 'model3d', title: 'Bracket' }).url.split(',')[1]!);
    expect(stl.match(/facet normal/g)).toHaveLength(12);
    expect(stl).toMatch(/^solid /);
    expect(stl.trimEnd()).toMatch(/endsolid [\w-]+$/);
  });

  it.each(['animation', 'game', 'podcast', 'resume', 'template'] as const)('never offers a %s export as a preview image', (kind) => {
    const artifact = buildBrowserCreativeArtifact({ kind, title: 'Launch artifact' });
    expect(creativePreviewImageUrl({ kind, title: 'Launch artifact', outputUrl: artifact.url })).toBeNull();
  });

  it('shows an image export directly, because it is one', () => {
    const artifact = buildBrowserCreativeArtifact({ kind: 'image', title: 'Hero' });
    expect(creativePreviewImageUrl({ kind: 'image', title: 'Hero', outputUrl: artifact.url })).toBe(artifact.url);
  });

  it('hands a new tab a URL it is allowed to navigate to', () => {
    const artifact = buildBrowserCreativeArtifact({ kind: 'game', title: 'Runner' });
    // A browser refuses to open a data: URL in a top-level tab.
    expect(artifact.url.startsWith('data:')).toBe(true);
    expect(navigableArtifactUrl(artifact.url)).toMatch(/^blob:/);
    expect(navigableArtifactUrl('https://cdn.test/report.html')).toBe('https://cdn.test/report.html');
  });

  it.each([
    ['https://cdn.test/render.png', true], ['blob:https://app.test/1234', true], ['https://cdn.test/model.stl', false],
    ['data:model/stl;charset=utf-8,solid', false], ['data:image/png;base64,AAAA', true], ['', false],
  ] as const)('classifies %s as displayable=%s', (url, displayable) => {
    expect(isDisplayableImageUrl(url)).toBe(displayable);
  });
});
