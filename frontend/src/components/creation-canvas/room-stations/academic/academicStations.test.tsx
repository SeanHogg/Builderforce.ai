import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import type { CanvasBoardBridge } from '../../canvasBoardBridge';

/**
 * The academic stations, through the room's no-WebGL reading — which is what jsdom
 * gets, and which must offer exactly what the 3D stands do: each station the board
 * brings in and the viewer is entitled to, with an Open that reaches its panel.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@/lib/canvas/canvas3d', () => ({
  canvas3dScene: () => ({ cards: [], links: [], layers: [], plane: { width: 0, height: 0 }, depthMode: 'flow' }),
}));

const { CanvasRoomSurface } = await import('../../CanvasRoomSurface');
const { CanvasBoardBridgeProvider } = await import('../../canvasBoardBridge');
const { CardActProvider } = await import('../../cardActRunner');

function object(id: string, data: Record<string, unknown>): CanvasObject {
  return { id, type: 'creation', position: { x: 0, y: 0 }, data: data as CanvasObject['data'] };
}

const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();

const OBJECTS: CanvasObject[] = [
  object('cohort', { kind: 'cohort', title: 'Cohort A', roster: [{ ref: 'l1', name: 'Ada' }, { ref: 'l2', name: 'Grace' }] }),
  object('essay', { kind: 'assignment', title: 'Essay 1', assessmentMode: 'closed', releaseAt: iso(-60), dueAt: iso(120), weight: 100, maxMarks: 100 }),
  object('s1', { kind: 'submission', learnerRef: 'l1', learnerName: 'Ada', assignmentRef: 'Essay 1', submittedAt: iso(-30), mark: 30 }),
  object('gb', {
    kind: 'gradebook', title: 'Module marks', cohortRef: 'Cohort A', assignments: ['Essay 1'],
    gradeBands: [{ grade: 'Fail', minimum: 0, maximum: 49.99 }, { grade: 'Pass', minimum: 50, maximum: 100 }],
  }),
  object('lecture', { kind: 'lecture', title: 'Week 1 lecture', recordingUrl: 'https://example.test/week1.mp4' }),
  object('cite', { kind: 'citation', title: 'Thermal transport in layered solids', citationKey: 'rao2026', authors: ['Rao, Grace I.'], year: '2026' }),
];

function renderRoom(overrides: Partial<CanvasBoardBridge> = {}) {
  const runner = vi.fn();
  const bridge: CanvasBoardBridge = {
    sessionId: 'academic-stations-test',
    title: 'PHYS2041',
    persistence: 'local',
    objects: OBJECTS,
    viewer: { userId: 'u-teacher', displayName: 'Teacher' },
    edits: { patch: vi.fn(), add: vi.fn(() => 'x'), remove: vi.fn() },
    notice: vi.fn(),
    ...overrides,
  };
  render(
    <CardActProvider runner={runner}>
      <CanvasBoardBridgeProvider value={bridge}>
        <CanvasRoomSurface
          sessionId="academic-stations-test"
          sessionTitle="PHYS2041"
          members={[]}
          currentUserId={null}
          live={new Map() as never}
          onPresence={vi.fn()}
          sceneInput={{ nodes: [] } as never}
          renderSession={() => <div data-testid="session" />}
          creations={[]}
          onOpenCreation={vi.fn()}
          onExit={vi.fn()}
        />
      </CanvasBoardBridgeProvider>
    </CardActProvider>,
  );
  return { runner };
}

const stationNames = () => screen.getAllByTestId('room-station').map((row) => row.querySelector('strong')?.textContent);

describe('CanvasRoomSurface — academic stations', () => {
  it('stands the four academic stations the board brings in', () => {
    renderRoom();
    expect(stationNames()).toEqual(expect.arrayContaining(['Assessment desk', 'Gradebook', 'Accessibility audit', 'Citations desk']));
  });

  it('keeps the gradebook off the wall for a viewer who cannot edit the board', () => {
    renderRoom({ edits: null });
    expect(stationNames()).not.toContain('Gradebook');
    expect(stationNames()).toContain('Assessment desk');
  });

  it('says in words that a closed-book paper is live and the assistant is off', () => {
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Assessment desk' }));
    const panel = screen.getByTestId('assessment-desk-panel');
    expect(within(panel).getByText(/A closed-book assessment is live/)).toBeInTheDocument();
    expect(within(within(panel).getByTestId('assessment-row')).getByText('Closed book')).toBeInTheDocument();
  });

  it('leads the gradebook with who is at risk, flagged in words, and exports through the card act', () => {
    const { runner } = renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Gradebook' }));
    const panel = screen.getByTestId('gradebook-board-panel');
    const atRisk = within(panel).getAllByTestId('at-risk-learner').map((row) => row.querySelector('strong')?.textContent);
    expect(atRisk).toEqual(['Grace', 'Ada']);
    expect(within(panel).getAllByText('At risk')).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: 'Export Module marks as CSV' }));
    expect(runner).toHaveBeenCalledWith('gb', 'export');
  });

  it('audits the uncaptioned lecture against its WCAG criterion', () => {
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Accessibility audit' }));
    const finding = screen.getByTestId('a11y-finding');
    expect(within(finding).getByText('Week 1 lecture')).toBeInTheDocument();
    expect(within(finding).getByText(/Needs captions · WCAG 1\.2\.2/)).toBeInTheDocument();
  });

  it('copies the in-text citation for the writer and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: 'Open Citations desk' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy the in-text citation for Thermal transport in layered solids' }));
    expect(writeText).toHaveBeenCalledWith('(Rao, 2026)');
    await waitFor(() => expect(screen.getByText(/Copied \(Rao, 2026\)/)).toBeInTheDocument());
  });
});
