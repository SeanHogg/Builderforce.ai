import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanLimitError } from '@/lib/planLimitError';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const loadLivePreview = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  loadLivePreview,
}));

const { LivePreviewPanel } = await import('./LivePreviewPanel');
const { isExpoPreviewUrl } = await import('./useLivePreview');

const LINK = {
  url: 'https://preview.example.test/app',
  expiresInSeconds: 600,
  status: 'live' as const,
};

beforeEach(() => {
  loadLivePreview.mockReset();
  loadLivePreview.mockResolvedValue(LINK);
});

describe('isExpoPreviewUrl', () => {
  it('recognises exp:// and exps:// and nothing else', () => {
    expect(isExpoPreviewUrl('exp://192.168.1.5:8081')).toBe(true);
    expect(isExpoPreviewUrl('exps://u.expo.dev/abc')).toBe(true);
    expect(isExpoPreviewUrl('https://preview.example.test')).toBe(false);
  });
});

describe('LivePreviewPanel', () => {
  it('loads the preview into a sandboxed iframe', async () => {
    render(<LivePreviewPanel projectId={42} />);
    const iframe = await screen.findByTitle('Live preview');
    expect(iframe).toHaveAttribute('src', LINK.url);
    expect(iframe).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups',
    );
  });

  it('still shows the iframe in a 360px drawer', async () => {
    const { container } = render(
      <div style={{ width: 360, height: 360 }}>
        <LivePreviewPanel projectId={42} />
      </div>,
    );
    await screen.findByTitle('Live preview');
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
  });

  it('renders UpgradeGate on a plan-limit 402', async () => {
    loadLivePreview.mockRejectedValue(new PlanLimitError({
      error: 'upgrade_required',
      upgradeRequired: true,
      currentPlan: 'free',
      requiredPlan: 'pro',
    }));
    render(<LivePreviewPanel projectId={42} />);
    expect(await screen.findByRole('region', { name: /higher plan/i })).toBeInTheDocument();
    expect(screen.queryByTitle('Live preview')).toBeNull();
  });

  it('shows the empty state when no preview is running', async () => {
    loadLivePreview.mockResolvedValue(null);
    render(<LivePreviewPanel projectId={42} />);
    expect(await screen.findByText('No live preview is running.')).toBeInTheDocument();
  });

  it('renders a QR code instead of an iframe for Expo URLs', async () => {
    loadLivePreview.mockResolvedValue({
      ...LINK,
      url: 'exp://192.168.1.5:8081',
    });
    render(<LivePreviewPanel projectId={42} />);
    expect(await screen.findByRole('img', { name: 'QR code for the Expo preview' })).toBeInTheDocument();
    expect(screen.queryByTitle('Live preview')).toBeNull();
  });

  it('switches the iframe src when a service tab is selected', async () => {
    loadLivePreview.mockResolvedValue({
      ...LINK,
      services: [
        { id: 'web', label: 'Web', url: 'https://preview.example.test/web' },
        { id: 'api', label: 'API', url: 'https://preview.example.test/api' },
      ],
    });
    render(<LivePreviewPanel projectId={42} />);
    const iframe = await screen.findByTitle('Live preview');
    expect(iframe).toHaveAttribute('src', 'https://preview.example.test/web');
    fireEvent.click(screen.getByRole('tab', { name: 'API' }));
    expect(screen.getByTitle('Live preview')).toHaveAttribute('src', 'https://preview.example.test/api');
  });

  it('remints the preview ticket on Restart', async () => {
    render(<LivePreviewPanel projectId={42} />);
    await screen.findByTitle('Live preview');
    expect(loadLivePreview).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(loadLivePreview).toHaveBeenCalledTimes(2));
  });
});
