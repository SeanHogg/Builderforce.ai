import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BrainRunSnapshot, RunKey } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { roomStationInstances } from '@/lib/canvas/roomStations';
import type { CanvasBoardBridge } from '../canvasBoardBridge';

/**
 * The agent station: it stands once per agent the app's manifest declares, reads its
 * state off the agent's run cell (not an animation), and steers / cancels through the
 * canvas's MCP tool-call client.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

/** The run cells a test sets, by key. */
const cells = vi.hoisted(() => new Map<string, Partial<BrainRunSnapshot>>());
vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>();
  return {
    ...actual,
    useRunSnapshot: (key: RunKey | null) => {
      const snapshot = actual.useRunSnapshot(key);
      const override = key == null ? undefined : cells.get(String(key));
      return override ? { ...snapshot, ...override } : snapshot;
    },
  };
});

const callTool = vi.hoisted(() => vi.fn(async (_tool: string, _args: Record<string, unknown>) => ({ ok: true })));
vi.mock('@/lib/runTarget/runtimeTools/runtimeToolRouter', () => ({ callServerRuntimeTool: callTool }));

const askBrain = vi.hoisted(() => vi.fn());
vi.mock('../phase/CanvasPhaseContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../phase/CanvasPhaseContext')>()),
  useCanvasPhase: () => ({ askBrain }),
}));

const { ROOM_STATION_VIEWS } = await import('./registry');
const { CanvasBoardBridgeProvider } = await import('../canvasBoardBridge');

const SESSION = 'agent-station-test';
const MANIFEST = {
  version: 1,
  capabilities: { agents: {} },
  agents: {
    reviewer: { role: 'code-review', instructions: 'agents/reviewer.md', tools: ['env.fs.read', 'env.run'], memory: 'reviewer' },
  },
};

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

const OBJECTS: CanvasObject[] = [
  object('manifest', { kind: 'code', title: 'Manifest', path: '.builderforce/builderforce.json', language: 'json', content: JSON.stringify(MANIFEST) }),
];

const RECOVERED: Partial<BrainRunSnapshot> = {
  running: true,
  activity: { phase: 'thinking', startedAt: Date.now(), step: 4 },
  turn: { id: 'run-7', startedAt: Date.now() },
  trace: [
    { ts: '2026-11-24T00:00:00.000Z', category: 'tool', label: 'env.fs.read' },
    { ts: '2026-11-24T00:00:01.000Z', category: 'message', label: 'run.recovered', args: { step: 3, fromStep: 2 } },
  ],
};

function renderPanel() {
  const bridge: CanvasBoardBridge = {
    sessionId: SESSION, title: 'Agents', persistence: 'local', objects: OBJECTS,
    viewer: { userId: 'u1', displayName: 'Ada' }, edits: null, notice: vi.fn(),
  };
  const [instance] = roomStationInstances(OBJECTS).filter((candidate) => candidate.station === 'agents');
  const { Panel } = ROOM_STATION_VIEWS.agents;
  render(<CanvasBoardBridgeProvider value={bridge}><Panel instance={instance} /></CanvasBoardBridgeProvider>);
  return screen.getByTestId('agent-station-panel');
}

afterEach(() => {
  cells.clear();
  callTool.mockClear();
  askBrain.mockClear();
  document.documentElement.removeAttribute('data-theme');
});

describe('agent station', () => {
  it('stands once per declared agent, in the Make phase', () => {
    const instances = roomStationInstances(OBJECTS, undefined, { phase: 'make' }).filter((instance) => instance.station === 'agents');
    expect(instances).toEqual([{ key: 'agents:reviewer', station: 'agents', resourceId: 'reviewer', title: 'reviewer', lit: true }]);
    expect(roomStationInstances([]).some((instance) => instance.station === 'agents')).toBe(false);
  });

  it('renders the panel after a recovered snapshot: status, declaration, tools, role and history', () => {
    cells.set(`agent:${SESSION}:reviewer`, RECOVERED);
    const panel = renderPanel();
    expect(panel).toHaveAttribute('data-state', 'recovering');
    expect(screen.getByTestId('agent-station-status')).toHaveTextContent('Status: Recovering');
    expect(panel).toHaveTextContent('code-review');
    expect(panel).toHaveTextContent('agents/reviewer.md');
    expect(panel).toHaveTextContent('env.run');
    const history = within(screen.getByTestId('agent-station-history')).getAllByRole('listitem');
    expect(history[0]).toHaveTextContent('run.recovered');
    expect(history[1]).toHaveTextContent('env.fs.read');
  });

  it('steers and cancels through the MCP tool-call client, and chats through the one turn door', async () => {
    cells.set(`agent:${SESSION}:reviewer`, RECOVERED);
    renderPanel();
    const steer = screen.getByRole('button', { name: 'Steer' });
    expect(steer).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Direction for the agent'), { target: { value: 'Only review the API folder' } });
    fireEvent.click(steer);
    await waitFor(() => expect(callTool).toHaveBeenCalledWith('runtime.agents.steer', { agentId: 'reviewer', runId: 'run-7', message: 'Only review the API folder' }));
    expect(await screen.findByText('Direction sent to the agent.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(callTool).toHaveBeenLastCalledWith('runtime.agents.cancel', { agentId: 'reviewer', runId: 'run-7' }));
    expect(await screen.findByText('Cancel sent to the agent.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ask Brain about this agent' }));
    expect(askBrain).toHaveBeenCalledWith(expect.stringContaining('"reviewer"'));
  });

  it('has nothing to cancel for an idle agent', () => {
    renderPanel();
    expect(screen.getByTestId('agent-station-panel')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByRole('button', { name: 'Cancel run' })).toBeDisabled();
  });

  it.each(['dark', 'light'])('reads in the %s theme through the shared themed classes, with no inline colour', (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    cells.set(`agent:${SESSION}:reviewer`, RECOVERED);
    const panel = renderPanel();
    expect(document.documentElement).toHaveAttribute('data-theme', theme);
    expect(panel.className).toMatch(/panel/);
    expect(panel.className).toMatch(/canvasTokens/);
    expect(panel.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('fits a 360px viewport: no fixed widths, every control reachable', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    window.dispatchEvent(new Event('resize'));
    try {
      cells.set(`agent:${SESSION}:reviewer`, RECOVERED);
      const panel = renderPanel();
      expect(window.innerWidth).toBe(360);
      expect(panel.querySelectorAll('[style*="width"]')).toHaveLength(0);
      for (const name of ['Steer', 'Cancel run', 'Ask Brain about this agent']) expect(screen.getByRole('button', { name })).toBeVisible();
      expect(screen.getByLabelText('Direction for the agent')).toBeVisible();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});
