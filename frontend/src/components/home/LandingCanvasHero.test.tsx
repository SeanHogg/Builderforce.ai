import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingCanvasHero } from './LandingCanvasHero';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/** The hero starts a session through the SHARED starter, which both creates the
 *  local draft and records the visitor's intent — mocked here so the assertions
 *  can see both halves without a network call. */
const startGuestCreationSession = vi.fn(() => 'local-session-1');
vi.mock('@/lib/guestPromptCapture', () => ({
  startGuestCreationSession: (...args: unknown[]) => startGuestCreationSession(...(args as [])),
}));

/** The real composer pulls in the shared prompt package; this stands in for it. */
vi.mock('@/components/ChatInput', () => ({
  ChatInput: ({ value, onChange, onSubmit, placeholder }: {
    value: string; onChange: (next: string) => void; onSubmit: () => void; placeholder: string;
  }) => (
    <div>
      <textarea aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      <button type="button" onClick={onSubmit}>send</button>
    </div>
  ),
}));

const OBJECTS = [
  { kind: 'Dataset', title: 'Q3 pipeline.csv', detail: '1,284 rows', prefill: 'Chart the win rate by channel' },
  { kind: 'Chart', title: 'Win rate by channel', detail: 'Computed', prefill: 'Turn this chart into an update' },
  { kind: 'Agent', title: 'Revenue analyst', detail: 'Writes the brief', prefill: 'Review the pipeline' },
  { kind: 'Workflow', title: 'Renewal outreach', detail: '4 steps', prefill: 'Build a renewal workflow' },
  { kind: 'Document', title: 'Board one-pager', detail: 'Drafted', prefill: 'Draft a one-pager' },
];
const raw: Record<string, unknown> = {
  'canvas.objects': OBJECTS,
  heroExamples: ['A pricing page', 'A campaign workflow'],
};

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const translate = (key: string) => key;
    translate.raw = (key: string) => raw[key] ?? [];
    translate.rich = (key: string) => key;
    return translate;
  },
}));

/** `matches: false` ⇒ a wide viewport, so the board is allowed to mount. */
function stubViewport(narrow: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
}

describe('LandingCanvasHero', () => {
  beforeEach(() => {
    push.mockClear();
    startGuestCreationSession.mockClear();
    stubViewport(false);
  });

  it('seeds the board with every localized object once mounted on a wide viewport', async () => {
    render(<LandingCanvasHero />);
    await waitFor(() => expect(screen.getByText('Q3 pipeline.csv')).toBeInTheDocument());
    for (const object of OBJECTS) expect(screen.getByText(object.title)).toBeInTheDocument();
  });

  it('starts a guest session and routes to the local canvas on submit', async () => {
    render(<LandingCanvasHero />);
    await waitFor(() => expect(screen.getByText('Q3 pipeline.csv')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('heroPromptPlaceholder'), { target: { value: 'Build me a pricing page' } });
    fireEvent.click(screen.getByText('send'));

    // The armed mode rides into the guest session — the composer's `/` menu is the
    // only place a visitor can set it, and it must survive the hand-off — and the
    // prompt is recorded as `landing` intent BEFORE the navigation, which is the
    // whole reason bounced visitors are no longer invisible.
    expect(startGuestCreationSession).toHaveBeenCalledWith(
      'Build me a pricing page',
      { mode: 'work', surface: 'landing' },
    );
    expect(push).toHaveBeenCalledWith('/create/local-session-1');
  });

  it('does not navigate on an empty prompt', async () => {
    render(<LandingCanvasHero />);
    await waitFor(() => expect(screen.getByText('Q3 pipeline.csv')).toBeInTheDocument());
    fireEvent.click(screen.getByText('send'));
    expect(push).not.toHaveBeenCalled();
    // Nothing typed is not intent — an empty submit must not create a lead.
    expect(startGuestCreationSession).not.toHaveBeenCalled();
  });

  it('seeds the composer from a board object instead of navigating away', async () => {
    render(<LandingCanvasHero />);
    await waitFor(() => expect(screen.getByText('Revenue analyst')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Revenue analyst'));

    expect(screen.getByLabelText('heroPromptPlaceholder')).toHaveValue('Review the pipeline');
    expect(push).not.toHaveBeenCalled();
  });

  it('renders no board on a narrow viewport but keeps the composer usable', async () => {
    stubViewport(true);
    render(<LandingCanvasHero />);

    await waitFor(() => expect(screen.getByText('canvas.narrowNote')).toBeInTheDocument());
    expect(screen.queryByText('Q3 pipeline.csv')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('heroPromptPlaceholder'), { target: { value: 'A campaign' } });
    fireEvent.click(screen.getByText('send'));
    expect(push).toHaveBeenCalledWith('/create/local-session-1');
  });
});
