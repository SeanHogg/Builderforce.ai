/**
 * The panel's two exits and its two rails.
 *
 * Both regressions these cover were reported from the running app: the ✕ that
 * did nothing on `/create`, and a rail that could only ever scroll — useless to
 * a reference page whose sections are tabs, because only one of them is in the
 * DOM at a time.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRouter } from 'next/navigation';
import { ShellPanel } from './ShellPanel';
import {
  ReferenceChromeProvider,
  usePublishReferenceChrome,
  usePublishReferenceSelect,
  useReferenceRailActive,
} from '@/lib/referenceChrome';
import { ActiveCanvasProvider, useOptionalActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import type { ActiveCanvas } from '@/lib/canvas/ActiveCanvasContext';
import { useEffect } from 'react';

vi.mock('./ShellIndex', () => ({
  ShellIndex: () => null,
  useShellIndex: () => ({ group: null, items: [] }),
}));

const BOARD: ActiveCanvas = {
  sessionId: 'local-abc',
  persistence: 'local',
  focusId: null,
  shareOpen: false,
  buildOpen: false,
  buildChatId: null,
  buildTicket: null,
  prompt: null,
  present: false,
  modelComparisonIds: [],
};

/** Puts a board on the stage, the way `LastBoardBridge` does at runtime. */
function SeedBoard() {
  const canvas = useOptionalActiveCanvas();
  const open = canvas?.open;
  useEffect(() => { open?.(BOARD); }, [open]);
  return null;
}

function Harness({ children }: { children?: React.ReactNode }) {
  return (
    <ActiveCanvasProvider stageHosted>
      <ReferenceChromeProvider>
        <SeedBoard />
        <ShellPanel>{children}</ShellPanel>
      </ReferenceChromeProvider>
    </ActiveCanvasProvider>
  );
}

/** A reference page whose sections are TABS — it publishes a selector, not anchors. */
function TabbedPage({ onSelect }: { onSelect: (id: string) => void }) {
  usePublishReferenceChrome({
    title: 'Embedded',
    sections: [{ id: 'features', label: 'Capabilities' }, { id: 'install', label: 'Install' }],
    activeId: 'features',
  });
  usePublishReferenceSelect(onSelect);
  return <p>tabbed body</p>;
}

/**
 * A page that owns a tab bar of its own — the `/dashboard` shape. Standalone the
 * bar is the only control; in a panel the rail is the same control, so the bar
 * must stand down rather than render the same five buttons twice.
 */
function PageWithOwnTabs() {
  usePublishReferenceChrome({
    title: 'Dashboard',
    sections: [{ id: 'create', label: 'Create' }, { id: 'projects', label: 'Projects' }],
    activeId: 'create',
  });
  usePublishReferenceSelect(() => {});
  const railHasTabs = useReferenceRailActive();
  return railHasTabs ? <p>body only</p> : <nav aria-label="inline tabs"><button type="button">Projects</button></nav>;
}

/** A reference page whose sections are anchors on one long page. */
function AnchoredPage() {
  usePublishReferenceChrome({
    title: 'SOC 2',
    sections: [{ id: 'report', label: 'Report' }, { id: 'criteria', label: 'Criteria' }],
  });
  return <p>anchored body</p>;
}

describe('ShellPanel', () => {
  beforeEach(() => {
    vi.mocked(useRouter()).push.mockClear();
  });

  it('closes to the BOARD, by id — not to the route it is already on', () => {
    render(<Harness><p>body</p></Harness>);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    // `/create` would have resolved to the canvas library — itself a panel — so
    // on `/create` the ✕ was inert.
    expect(vi.mocked(useRouter()).push).toHaveBeenCalledWith(`/create/${BOARD.sessionId}`);
  });

  it('renders a SELECTOR rail when the page publishes one', () => {
    const onSelect = vi.fn();
    render(<Harness><TabbedPage onSelect={onSelect} /></Harness>);

    const install = screen.getByRole('button', { name: 'Install' });
    fireEvent.click(install);
    expect(onSelect).toHaveBeenCalledWith('install');
    // …and it marks where you are, which an anchor rail cannot.
    expect(screen.getByRole('button', { name: 'Capabilities' })).toHaveAttribute('aria-current', 'true');
    // Selecting a view must never navigate — the board is behind this panel.
    expect(vi.mocked(useRouter()).push).not.toHaveBeenCalled();
  });

  it('renders an ANCHOR rail when the page publishes no selector', () => {
    render(<Harness><AnchoredPage /></Harness>);
    expect(screen.getByRole('link', { name: 'Criteria' })).toHaveAttribute('href', '#criteria');
    expect(screen.queryByRole('button', { name: 'Criteria' })).toBeNull();
  });

  it('claims the rail so the page drops its own copy of the same tabs', () => {
    const { unmount } = render(<Harness><PageWithOwnTabs /></Harness>);
    expect(screen.queryByRole('navigation', { name: 'inline tabs' })).toBeNull();
    expect(screen.getByText('body only')).toBeInTheDocument();
    unmount();

    // …and standalone, with no panel to take it over, the bar is still there.
    render(<ReferenceChromeProvider><PageWithOwnTabs /></ReferenceChromeProvider>);
    expect(screen.getByRole('navigation', { name: 'inline tabs' })).toBeInTheDocument();
  });

  it('leaves an ANCHOR rail unclaimed — it is a contents list, not a control', () => {
    function RailProbe() {
      return <span data-testid="claimed">{String(useReferenceRailActive())}</span>;
    }
    render(<Harness><AnchoredPage /><RailProbe /></Harness>);
    // An anchor rail sits BESIDE the page rather than replacing anything in it,
    // so it must never tell a page one of its controls is already on screen.
    expect(screen.getByTestId('claimed')).toHaveTextContent('false');
  });
});
