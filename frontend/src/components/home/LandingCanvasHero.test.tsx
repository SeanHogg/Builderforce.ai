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
  { kind: 'Idea', title: 'Retention opportunity', detail: 'Problem and first bet', prefill: 'Turn this idea into a plan' },
  { kind: 'Research', title: 'Customer interviews', detail: '12 calls', prefill: 'Synthesize the interviews' },
  { kind: 'Prototype', title: 'Renewal portal', detail: 'Ready to test', prefill: 'Build the prototype' },
];
/** The always-on roster along the bottom of the board — agents are teammates. */
const TEAM = [
  { short: 'CM', name: 'CMO', prefill: 'Bring the CMO in to plan this campaign' },
  { short: 'CF', name: 'CFO', prefill: 'Bring the CFO in to forecast the budget' },
  { short: 'CT', name: 'CTO', prefill: 'Bring the CTO in to review the ship path' },
];

const raw: Record<string, unknown> = {
  'canvas.objects': OBJECTS,
  'canvas.team': TEAM,
  'canvas.presenceInitials': ['SH', 'JR', 'TK'],
  items: [
    { category: 'apps', label: 'Mobile app design', prompt: 'Design a mobile app with its key screens and user flow.' },
    { category: 'documents', label: 'Slides', prompt: 'Create a polished slide deck.' },
  ],
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
    expect(screen.getByText('Revenue analyst').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(push).not.toHaveBeenCalled();
  });

  it('seeds the composer from an always-on teammate and clears the object selection', async () => {
    render(<LandingCanvasHero />);
    await waitFor(() => expect(screen.getByText('Revenue analyst')).toBeInTheDocument());

    // Objects and teammates share ONE selection, so seeding from the roster has to
    // release whichever object was pressed — two parallel selections would let the
    // board claim two things seeded the same composer.
    fireEvent.click(screen.getByText('Revenue analyst'));
    expect(screen.getByText('Revenue analyst').closest('button')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByText('CFO'));

    expect(screen.getByLabelText('heroPromptPlaceholder')).toHaveValue('Bring the CFO in to forecast the budget');
    expect(screen.getByText('CFO').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Revenue analyst').closest('button')).toHaveAttribute('aria-pressed', 'false');
    // The roster is an invitation, not a link — it must never navigate.
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the always-on roster and the session presence on the board', async () => {
    render(<LandingCanvasHero />);
    await screen.findByText('Q3 pipeline.csv');

    for (const mate of TEAM) expect(screen.getByText(mate.name)).toBeInTheDocument();
    expect(screen.getByText('canvas.alwaysOn')).toBeInTheDocument();
    expect(screen.getByLabelText('canvas.presenceAria')).toBeInTheDocument();
    expect(screen.getByText('canvas.sessionTitle')).toBeInTheDocument();
  });

  it('expands supported use cases below the homepage prompt and seeds the selected prompt', async () => {
    render(<LandingCanvasHero />);
    await screen.findByText('Q3 pipeline.csv');

    const tab = screen.getByRole('button', { name: /tabLabel/ });
    expect(tab).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(tab);
    expect(tab).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Mobile app design' }));
    expect(screen.getByLabelText('heroPromptPlaceholder')).toHaveValue('Design a mobile app with its key screens and user flow.');
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it('reveals the board from the prompt and resets interactions on an outside click', async () => {
    render(<LandingCanvasHero />);
    const board = await screen.findByRole('group', { name: 'canvas.boardAria' });
    const prompt = screen.getByLabelText('heroPromptPlaceholder');

    fireEvent.pointerDown(prompt);
    expect(board).toHaveAttribute('data-revealed', 'true');

    fireEvent.pointerDown(board);
    expect(board).toHaveAttribute('data-revealed', 'false');

    fireEvent.pointerDown(prompt);
    fireEvent.pointerDown(document.body);
    expect(board).toHaveAttribute('data-revealed', 'false');
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
