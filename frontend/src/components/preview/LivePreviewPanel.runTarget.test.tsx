import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CANVAS_APP, HIRED_VIDEO } from '@/lib/runTarget/blueprintFixtures';
import type { RunService, RunSession } from '@/lib/runTarget/runTarget';
import { PlanLimitError } from '@/lib/planLimitError';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const fetchProjectBlueprint = vi.hoisted(() => vi.fn());
const loadLivePreview = vi.hoisted(() => vi.fn());
const browserStart = vi.hoisted(() => vi.fn());

vi.mock('@/lib/appBlueprintApi', () => ({ fetchProjectBlueprint }));
vi.mock('@/lib/siteApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/siteApi')>()),
  loadLivePreview,
}));
// The browser target's real accept check decides; only its start (the runtime) is faked.
vi.mock('@/lib/runTarget/browserRunTarget', async () => {
  const { acceptBlueprintInBrowser } = await import('@/lib/runTarget/browserAcceptance');
  return {
    browserRunTarget: {
      id: 'browser',
      startsOn: 'request',
      accepts: (blueprint: never) => {
        const verdict = acceptBlueprintInBrowser(blueprint);
        return verdict.ok ? { ok: true } : verdict;
      },
      start: browserStart,
    },
  };
});

const { LivePreviewPanel } = await import('./LivePreviewPanel');
const { activeRunFor } = await import('@/lib/runTarget/activeRun');

function browserSession(services: RunService[]): RunSession {
  return {
    targetId: 'browser',
    services: () => services,
    url: (id) => services.find((s) => s.id === id)?.url,
    logs: () => new ReadableStream({
      start(controller) {
        controller.enqueue({ serviceId: 'api', text: 'listening on 8000', at: 1 });
        controller.close();
      },
    }),
    restart: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onState: () => () => undefined,
  };
}

const LIVE: RunService[] = [
  { id: 'db', label: 'db', state: 'live', previewable: false },
  { id: 'web', label: 'web', state: 'live', previewable: true, url: 'https://preview.test/web' },
  { id: 'api', label: 'api', state: 'live', previewable: true, url: 'https://preview.test/api' },
];

beforeEach(() => {
  fetchProjectBlueprint.mockReset();
  loadLivePreview.mockReset();
  browserStart.mockReset();
});

describe('LivePreviewPanel — run targets', () => {
  it('waits for Run before starting a browser app, then shows tabs, restart, logs and where it runs', async () => {
    fetchProjectBlueprint.mockResolvedValue(CANVAS_APP);
    const session = browserSession(LIVE);
    browserStart.mockResolvedValue({ ok: true, session });
    render(<div style={{ width: 360 }}><LivePreviewPanel projectId={7} /></div>);

    const run = await screen.findByRole('button', { name: 'Run in your browser' });
    expect(browserStart).not.toHaveBeenCalled();
    expect(loadLivePreview).not.toHaveBeenCalled();
    fireEvent.click(run);

    expect(await screen.findByTitle('Live preview')).toHaveAttribute('src', 'https://preview.test/web');
    expect(browserStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Running in your browser')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'db' })).toBeNull();
    expect(activeRunFor('7')?.session).toBe(session);

    fireEvent.click(screen.getByRole('tab', { name: 'api' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(session.restart).toHaveBeenCalledWith('api');

    fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('listening on 8000')).toBeInTheDocument();
  });

  it('names a failed service with its error', async () => {
    fetchProjectBlueprint.mockResolvedValue(CANVAS_APP);
    browserStart.mockResolvedValue({ ok: true, session: browserSession([
      { id: 'web', label: 'web', state: 'live', previewable: true, url: 'https://preview.test/web' },
      { id: 'api', label: 'api', state: 'failed', previewable: true, error: 'exited with code 1' },
    ]) });
    render(<LivePreviewPanel projectId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run in your browser' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('api stopped with an error.');
    expect(screen.getByRole('alert')).toHaveTextContent('exited with code 1');
  });

  it('says the app stopped when every service is stopped (the editor took the runtime)', async () => {
    fetchProjectBlueprint.mockResolvedValue(CANVAS_APP);
    browserStart.mockResolvedValue({ ok: true, session: browserSession(LIVE.map((s) => ({ ...s, state: 'stopped' as const }))) });
    render(<LivePreviewPanel projectId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run in your browser' }));
    expect(await screen.findByText(/The app stopped/)).toBeInTheDocument();
  });

  it('runs the hired.video shape in the container and says why not the browser', async () => {
    fetchProjectBlueprint.mockResolvedValue(HIRED_VIDEO);
    loadLivePreview.mockResolvedValue({ url: 'https://preview.test/app', expiresInSeconds: 600, status: 'live' });
    render(<LivePreviewPanel projectId={99} />);

    expect(await screen.findByTitle('Live preview')).toHaveAttribute('src', 'https://preview.test/app');
    expect(browserStart).not.toHaveBeenCalled();
    expect(screen.getByText('Running in a cloud container')).toBeInTheDocument();
    expect(screen.getByText('Not in the browser:')).toBeInTheDocument();
    expect(screen.getByText(/wrangler dev/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logs' })).toBeNull();
  });

  it('tries the container first for an execution, and offers the browser when it is not there', async () => {
    fetchProjectBlueprint.mockResolvedValue(CANVAS_APP);
    loadLivePreview.mockResolvedValue(null);
    render(<LivePreviewPanel projectId={7} executionId={12} />);
    expect(await screen.findByRole('button', { name: 'Run in your browser' })).toBeInTheDocument();
    expect(loadLivePreview).toHaveBeenCalledWith({ projectId: '7', executionId: 12 });
    expect(screen.getByText('No container is holding a live preview.')).toBeInTheDocument();
  });

  it('states every decline when nothing can run the app', async () => {
    fetchProjectBlueprint.mockResolvedValue(HIRED_VIDEO);
    loadLivePreview.mockResolvedValue(null);
    render(<LivePreviewPanel projectId={99} />);
    expect(await screen.findByText('No live preview is running.')).toBeInTheDocument();
    expect(screen.getByText('No container is holding a live preview.')).toBeInTheDocument();
  });

  it('shows the plan gate WITH the reasons that led to it', async () => {
    fetchProjectBlueprint.mockResolvedValue(HIRED_VIDEO);
    loadLivePreview.mockRejectedValue(new PlanLimitError({ error: 'upgrade_required', upgradeRequired: true, currentPlan: 'free', requiredPlan: 'pro' }));
    render(<LivePreviewPanel projectId={99} />);
    expect(await screen.findByRole('region', { name: /higher plan/i })).toBeInTheDocument();
    expect(screen.getByText('Not in the browser:')).toBeInTheDocument();
  });

  it('says a failed blueprint read is a failed read, not "no blueprint"', async () => {
    fetchProjectBlueprint.mockRejectedValue(new Error('HTTP 500'));
    loadLivePreview.mockResolvedValue(null);
    render(<LivePreviewPanel projectId={7} />);
    expect(await screen.findByText('The app blueprint could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/No app blueprint has been detected/)).toBeNull();
  });
});
