import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/lib/api';
import { replayApi } from '@/lib/replayApi';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { PrescriptionPreviewPublish } from './PrescriptionPreviewPublish';

/**
 * Publish as preview for this fix (PRD 33 §5.1.4): only when the workspace was
 * opened for a fix (`?prescription=`); builds with the panel's own builder, posts a
 * PREVIEW release for that fix, then shows the private link and the way back to
 * the fix in Insights.
 */

const search = vi.hoisted(() => ({ current: '' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams(search.current),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  publishSitePreview: vi.fn(),
}));

const assets = [{ path: 'index.html', data: new Uint8Array([1]) }];
const result = { versionToken: 'rel-prev', liveVersionToken: 'rel-live', assetCount: 1, totalBytes: 1, url: 'https://shop.builderforce.ai', preview: true as const };

beforeEach(() => {
  search.current = 'panel=publish&prescription=rx-9';
  vi.mocked(api.publishSitePreview).mockResolvedValue(result);
  vi.spyOn(replaySitesApi, 'projectSite').mockResolvedValue({ id: 'site-1' } as never);
  vi.spyOn(replayApi, 'previewUrl').mockResolvedValue({ releaseKey: 'rel-prev', url: 'https://shop.builderforce.ai/?bf_preview=tok', expiresAt: '2026-10-29T12:30:00.000Z' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(api.publishSitePreview).mockReset();
});

describe('PrescriptionPreviewPublish', () => {
  it('renders nothing without a fix in the address', () => {
    search.current = 'panel=publish';
    const { container } = render(<PrescriptionPreviewPublish projectId={7} onBuild={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('builds, publishes a preview for the fix, and shows the link and the way back', async () => {
    const onBuild = vi.fn().mockResolvedValue(assets);
    render(<PrescriptionPreviewPublish projectId={7} onBuild={onBuild} />);
    fireEvent.click(screen.getByRole('button', { name: 'ide.publish.fixPreview.action' }));

    const open = await screen.findByRole('link', { name: 'ide.publish.fixPreview.openPreview' });
    expect(open).toHaveAttribute('href', 'https://shop.builderforce.ai/?bf_preview=tok');
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(api.publishSitePreview).toHaveBeenCalledWith(7, assets, 'rx-9');
    expect(replayApi.previewUrl).toHaveBeenCalledWith('site-1', 'rel-prev');

    const back = screen.getByRole('link', { name: 'ide.publish.fixPreview.backToFix' });
    const href = new URL(back.getAttribute('href')!, 'https://app.test');
    expect(href.pathname).toBe('/apps/insights');
    expect(href.searchParams.get('panel')).toBe('fix:rx-9');
  });

  it('says so, and still links back, when the private link cannot be minted', async () => {
    vi.mocked(replayApi.previewUrl).mockRejectedValue(new Error('nope'));
    render(<PrescriptionPreviewPublish projectId={7} onBuild={vi.fn().mockResolvedValue(assets)} />);
    fireEvent.click(screen.getByRole('button', { name: 'ide.publish.fixPreview.action' }));
    expect(await screen.findByText('ide.publish.fixPreview.noLink')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ide.publish.fixPreview.backToFix' })).toBeInTheDocument();
  });

  it('shows the failure and publishes nothing when the build fails', async () => {
    render(<PrescriptionPreviewPublish projectId={7} onBuild={vi.fn().mockRejectedValue(new Error('build broke'))} />);
    fireEvent.click(screen.getByRole('button', { name: 'ide.publish.fixPreview.action' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('build broke');
    await waitFor(() => expect(api.publishSitePreview).not.toHaveBeenCalled());
  });
});
