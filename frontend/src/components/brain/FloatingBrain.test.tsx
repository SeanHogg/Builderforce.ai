import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Shared, mutable mock state (hoisted so the vi.mock factories can read it).
const state = vi.hoisted(() => ({ pathname: '/', hasTenant: false, open: true }));
const takePendingPrompt = vi.hoisted(() => vi.fn((): string | null => null));

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ hasTenant: state.hasTenant }) }));
vi.mock('@/lib/brain', () => ({
  useBrainContext: () => ({
    open: state.open,
    setOpen: vi.fn(),
    projectId: null,
    modality: 'designer',
    extraSystem: undefined,
    initialChatId: null,
  }),
  takePendingPrompt,
}));
// BrainPanel (authed) and GuestBrainPanel (logged-out) both pull in the whole
// brain runtime; stub both — we only assert WHICH branch FloatingBrain renders,
// not the panel internals.
vi.mock('./BrainPanel', () => ({ BrainPanel: () => <div data-testid="brain-panel" /> }));
vi.mock('./GuestBrainPanel', () => ({ GuestBrainPanel: () => <div data-testid="guest-brain-panel" /> }));

import { FloatingBrain } from './FloatingBrain';

describe('FloatingBrain visibility + auth gating', () => {
  beforeEach(() => {
    state.pathname = '/';
    state.hasTenant = false;
    state.open = true;
    takePendingPrompt.mockClear();
    takePendingPrompt.mockReturnValue(null);
  });
  afterEach(cleanup);

  it('renders the guest chat panel (not the authed Brain) when unauthenticated', () => {
    // Logged-out visitors get a real, metered GUEST chat (guest token +
    // localStorage) rather than a dead-end sign-in wall — the top-of-funnel
    // "try the Brain" experience. The authed BrainPanel must NOT mount.
    const { getByTestId, queryByTestId } = render(<FloatingBrain />);
    expect(getByTestId('guest-brain-panel')).toBeTruthy();
    expect(queryByTestId('brain-panel')).toBeNull();
  });

  it('does NOT consume the pending landing-page prompt while unauthenticated', () => {
    // Regression: the launcher now mounts on marketing pages too. If it read +
    // cleared the pending prompt before sign-in, the landing→auth→replay handoff
    // would silently lose the prompt.
    render(<FloatingBrain />);
    expect(takePendingPrompt).not.toHaveBeenCalled();
  });

  it('renders the full Brain panel and replays the pending prompt once authenticated', () => {
    state.hasTenant = true;
    const { getByTestId } = render(<FloatingBrain />);
    expect(getByTestId('brain-panel')).toBeTruthy();
    expect(takePendingPrompt).toHaveBeenCalledTimes(1);
  });

  it('renders nothing on /brainstorm (the full Brain page already is the Brain)', () => {
    state.pathname = '/brainstorm';
    const { container } = render(<FloatingBrain />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on the auth pages where a sign-in CTA would be redundant', () => {
    for (const path of ['/login', '/register']) {
      state.pathname = path;
      const { container } = render(<FloatingBrain />);
      expect(container.firstChild).toBeNull();
      cleanup();
    }
  });
});
