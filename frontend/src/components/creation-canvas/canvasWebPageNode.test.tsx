import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { CreationNodeData } from './types';
import { CANVAS_PREVIEW_MESSAGE, CANVAS_PREVIEW_REPORT_LIMIT } from '@/lib/canvasPreviewReport';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

const fetchUrl = vi.fn();
vi.mock('@/lib/builderforceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/builderforceApi')>()),
  brain: { fetchUrl: (url: string) => fetchUrl(url) },
}));

const { CreationNode } = await import('./CreationNode');

function renderPage(data: Partial<CreationNodeData> = {}, onEditData?: (id: string, patch: Partial<CreationNodeData>) => void) {
  const nodeData = { kind: 'browser', title: 'Live preview', ...data } as CreationNodeData;
  return render(
    <ReactFlowProvider>
      <CreationNode
        id="page-1"
        type="creation"
        data={nodeData}
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        draggable={false}
        selectable={false}
        deletable={false}
        {...(onEditData ? { onEditData } : {})}
      />
    </ReactFlowProvider>,
  );
}

const probeResult = {
  url: 'https://example.com/', requestedUrl: 'https://example.com/', status: 200,
  contentType: 'text/html', title: 'Example', text: 'Readable page text.', truncated: false,
  frameable: true, frameBlockedBy: null as null,
};

describe('Web page panel', () => {
  beforeEach(() => { fetchUrl.mockReset(); fetchUrl.mockResolvedValue(probeResult); });

  it('asks for an address before it has one', () => {
    renderPage({ url: '' });
    expect(screen.getByText('No page loaded')).toBeInTheDocument();
    expect(screen.queryByTitle('Example')).not.toBeInTheDocument();
  });

  it('frames the live page and offers it in a new tab', async () => {
    const { container } = renderPage({ url: 'https://example.com/', frameCheckedUrl: 'https://example.com/', frameable: true });
    const frame = container.querySelector('iframe');
    expect(frame).toHaveAttribute('src', 'https://example.com/');
    // No `allow-top-navigation`: a framed page must not be able to steer the board away.
    expect(frame?.getAttribute('sandbox')).not.toContain('top-navigation');
    expect(screen.getByLabelText('Open in a new tab')).toHaveAttribute('href', 'https://example.com/');
  });

  it('probes an unseen address once and keeps the text it reads', async () => {
    const onEditData = vi.fn();
    renderPage({ url: 'https://example.com/' }, onEditData);
    await waitFor(() => expect(onEditData).toHaveBeenCalled());
    expect(fetchUrl).toHaveBeenCalledTimes(1);
    expect(onEditData.mock.calls[0]![1]).toMatchObject({
      frameCheckedUrl: 'https://example.com/', frameable: true, content: 'Readable page text.', pageTitle: 'Example',
    });
  });

  it('does not re-probe an address whose verdict is already stored', async () => {
    const onEditData = vi.fn();
    renderPage({ url: 'https://example.com/', frameCheckedUrl: 'https://example.com/', frameable: true }, onEditData);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it('never probes a dev server the gateway cannot reach', async () => {
    const onEditData = vi.fn();
    renderPage({ kind: 'service', title: 'Local service', url: 'http://localhost:5173/' }, onEditData);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it('falls back to the reader view when the origin refuses to be framed', () => {
    const { container } = renderPage({
      url: 'https://blocked.example/', frameCheckedUrl: 'https://blocked.example/',
      frameable: false, frameBlockedBy: 'x-frame-options', content: 'What the page says.',
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('blocked.example does not allow being embedded')).toBeInTheDocument();
    expect(screen.getByText('What the page says.')).toBeInTheDocument();
  });

  it('loads what the address bar is given, promoting a bare host to https', () => {
    const onEditData = vi.fn();
    renderPage({ url: '' }, onEditData);
    const address = screen.getByLabelText('Address');
    fireEvent.change(address, { target: { value: 'example.com/docs' } });
    fireEvent.keyDown(address, { key: 'Enter' });
    expect(onEditData).toHaveBeenCalledWith('page-1', expect.objectContaining({ url: 'https://example.com/docs', frameCheckedUrl: '' }));
  });

  it('refuses an address that would run script inside the board', () => {
    const onEditData = vi.fn();
    renderPage({ url: '' }, onEditData);
    const address = screen.getByLabelText('Address');
    fireEvent.change(address, { target: { value: 'javascript:alert(1)' } });
    fireEvent.keyDown(address, { key: 'Enter' });
    expect(onEditData).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid http:// or https:// address.')).toBeInTheDocument();
  });

  it('is read-only for a viewer who cannot edit the board', () => {
    renderPage({ url: 'https://example.com/', frameCheckedUrl: 'https://example.com/' });
    expect(screen.getByLabelText('Address')).toHaveAttribute('readonly');
  });
});

/**
 * A preview that says it is broken instead of looking fine.
 *
 * The half a browser will never give an embedder is the page's INSIDE — no
 * `contentWindow.console`, no error events, no failed-request entries — so these cover
 * the two routes that remain: the status the gateway saw (no cooperation needed) and what
 * the page reports over the preview wire (cooperation by construction, or by SDK).
 */
describe('Web page preview report', () => {
  beforeEach(() => { fetchUrl.mockReset(); fetchUrl.mockResolvedValue(probeResult); });

  const framed = { url: 'https://example.com/', frameCheckedUrl: 'https://example.com/', frameable: true };

  /** Post as the frame itself: the panel scopes on `event.source`, because several live
   *  pages on one board all post to the same `window`. */
  function reportFromFrame(container: HTMLElement, message: Record<string, unknown>) {
    const frame = container.querySelector('iframe')!;
    fireEvent(window, new MessageEvent('message', { data: message, source: frame.contentWindow }));
  }

  it('says the console is UNKNOWN, not clean, for a page that reports nothing', () => {
    renderPage(framed);
    expect(screen.getByText('This page does not report its console')).toBeInTheDocument();
  });

  it('reports what the framed page said about itself', async () => {
    const { container } = renderPage(framed);
    reportFromFrame(container, {
      tag: CANVAS_PREVIEW_MESSAGE, level: 'error', text: 'Cannot read properties of null', at: 12,
    });
    await waitFor(() => expect(screen.getByText('1 error reported by this page')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /1 error reported/ }));
    expect(screen.getByText('Cannot read properties of null')).toBeInTheDocument();
  });

  /** The defect this whole panel change exists to end: a card showing its NEIGHBOUR's
   *  errors, because a listener matched on the tag and not on the frame. */
  it('ignores a report that did not come from its own frame', async () => {
    renderPage(framed);
    fireEvent(window, new MessageEvent('message', {
      data: { tag: CANVAS_PREVIEW_MESSAGE, level: 'error', text: 'another card', at: 1 },
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('This page does not report its console')).toBeInTheDocument();
  });

  /** A 4xx/5xx body frames exactly like the real page. This is the only signal available
   *  for a page that carries no reporter at all, and it needs nothing from the page. */
  it('names a failing HTTP status even when the page reports nothing', () => {
    renderPage({ ...framed, httpStatus: 503 });
    expect(screen.getByText('This address returned HTTP 503')).toBeInTheDocument();
  });

  it('keeps the status the probe saw, so the strip has something to read', async () => {
    const onEditData = vi.fn();
    fetchUrl.mockResolvedValue({ ...probeResult, status: 404 });
    renderPage({ url: 'https://example.com/' }, onEditData);
    await waitFor(() => expect(onEditData).toHaveBeenCalled());
    expect(onEditData.mock.calls[0]![1]).toMatchObject({ httpStatus: 404 });
  });

  /** Written back so BRAIN reads a broken preview off the board, which is the whole
   *  point — bounded, and only after the run settles. */
  it('writes a bounded report onto the object for Brain to read', async () => {
    vi.useFakeTimers();
    try {
      const onEditData = vi.fn();
      const { container } = renderPage(framed, onEditData);
      for (let index = 0; index < 40; index += 1) {
        reportFromFrame(container, {
          tag: CANVAS_PREVIEW_MESSAGE, level: index === 0 ? 'error' : 'request',
          text: index === 0 ? 'boom on load' : `GET /api/${index}`, at: index,
        });
      }
      expect(onEditData).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_500);
      const patch = onEditData.mock.calls.at(-1)![1] as { previewLog: unknown[]; previewErrorCount: number; previewReported: boolean };
      expect(patch.previewErrorCount).toBe(1);
      expect(patch.previewReported).toBe(true);
      expect(patch.previewLog).toHaveLength(CANVAS_PREVIEW_REPORT_LIMIT);
      expect(patch.previewLog).toContainEqual({ level: 'error', text: 'boom on load', at: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
