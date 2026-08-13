import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { CreationNodeData } from './types';

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
