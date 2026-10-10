import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TemplateEntry } from '@/lib/templates/contract';
import { categoryServesPhase } from '@/lib/canvasPhaseStarters';
import { useComposerStarters } from '@/components/chat-input/useComposerStarters';
import { renderWithPhase } from '../phase/testPhaseProvider';
import { useCanvasNextSteps, useCanvasStarters } from './useCanvasComposerOffers';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * The catalogue, held to three categories whose phase is known from the C-suite owner
 * table: Research serves Idea only, Overview serves Measure only, and `creative` has no
 * owner at all. Stubbed because what is under test is the ORDER the canvas gives them,
 * not the catalogue's sources (covered by `PromptUseCasePicker.test.tsx`).
 */
const { CATALOG } = vi.hoisted(() => {
  const entry = (id: string, category: string, categoryLabel: string, name: string) => ({
    id, name, summary: name, category, categoryLabel, source: 'executive' as const, icon: 'template', keywords: [] as string[],
    action: { kind: 'prompt' as const, prompt: `${name} prompt` },
  });
  return {
    CATALOG: [
      entry('research.web_search', 'executiveResearch', 'Research', 'Web research'),
      entry('animation', 'creative', 'Creative', 'Animation'),
      entry('overview.board', 'executiveOverview', 'Overview', 'Board overview'),
    ],
  };
});
vi.mock('@/lib/templates/useTemplateCatalog', () => ({ useTemplateCatalog: (): TemplateEntry[] => CATALOG as unknown as TemplateEntry[] }));

/** The canvas's offer, opened the way every prompt opens it: the `+` row. */
function Starters({ onPrompt = vi.fn() }: { onPrompt?: (prompt: string) => void }) {
  const starters = useCanvasStarters({ onPrompt, onTwilioJourney: vi.fn(), onPack: vi.fn() });
  const control = useComposerStarters(starters);
  return <>
    <button type="button" onClick={control.menuItem!.onSelect}>{control.menuItem!.label}</button>
    {control.catalog}
  </>;
}

function NextSteps({ conversationStarted, surface = 'app' as const }: { conversationStarted: boolean; surface?: 'app' | 'graph' }) {
  const steps = useCanvasNextSteps({ surface, conversationStarted, onPrompt: vi.fn() });
  return <ul>{steps?.map((step) => <li key={step.id}>{step.label}</li>)}</ul>;
}

/** Section headings in the order the list draws them. */
const headings = (root: HTMLElement) => [...root.querySelectorAll('section')].map((section) => section.firstElementChild?.textContent);

describe('the canvas composer\'s starting points, led by the phase (PRD 32 · W8)', () => {
  it('reads the fixture categories the way the owner table does', () => {
    expect(categoryServesPhase('executiveOverview', 'measure')).toBe(true);
    expect(categoryServesPhase('executiveResearch', 'measure')).toBe(false);
    expect(categoryServesPhase('executiveResearch', 'idea')).toBe(true);
    expect(categoryServesPhase('creative', 'idea')).toBe(false);
  });

  it('names the phase on the `+` row', () => {
    renderWithPhase(<Starters />, { phase: 'measure' });
    expect(screen.getByRole('button', { name: 'Starting points · Measure' })).toBeInTheDocument();
  });

  it('leads with the phase\'s three starters, then the use cases that serve it, then the rest', () => {
    const { container } = renderWithPhase(<Starters />, { phase: 'measure' });
    fireEvent.click(screen.getByRole('button', { name: 'Starting points · Measure' }));
    const lead = screen.getByTestId('prompt-use-case-lead');
    expect(within(lead).getAllByRole('button').map((button) => button.lastElementChild?.textContent)).toEqual([
      'Define the key metric',
      'Build a dashboard',
      'Read an experiment',
    ]);
    expect(headings(container as HTMLElement)).toEqual(['Starting points · Measure', 'Overview', 'Research', 'Creative']);
  });

  it('orders by the CURRENT phase — the same catalogue reads differently in Idea', () => {
    const { container } = renderWithPhase(<Starters />, { phase: 'idea' });
    fireEvent.click(screen.getByRole('button', { name: 'Starting points · Idea' }));
    expect(within(screen.getByTestId('prompt-use-case-lead')).getAllByRole('button')[0]).toHaveTextContent('Capture the idea');
    expect(headings(container as HTMLElement)).toEqual(['Starting points · Idea', 'Research', 'Creative', 'Overview']);
  });

  it('seeds the composer with a starter\'s prompt and closes the list — it never sends', () => {
    const onPrompt = vi.fn();
    renderWithPhase(<Starters onPrompt={onPrompt} />, { phase: 'measure' });
    fireEvent.click(screen.getByRole('button', { name: 'Starting points · Measure' }));
    fireEvent.click(within(screen.getByTestId('prompt-use-case-lead')).getByRole('button', { name: 'Define the key metric' }));
    expect(onPrompt).toHaveBeenCalledWith('Define the one metric that says whether this app is working, with a target, and put it on the board.');
    expect(screen.queryByTestId('composer-starters')).toBeNull();
  });

  it('drops the lead while searching, so a query reads the whole catalogue', () => {
    renderWithPhase(<Starters />, { phase: 'measure' });
    fireEvent.click(screen.getByRole('button', { name: 'Starting points · Measure' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'animation' } });
    expect(screen.queryByTestId('prompt-use-case-lead')).toBeNull();
    expect(screen.getByRole('button', { name: 'Animation' })).toBeInTheDocument();
  });

  it('keeps the plain list and wording outside a canvas', () => {
    const { container } = render(<Starters />);
    fireEvent.click(screen.getByRole('button', { name: 'Starting points' }));
    expect(screen.queryByTestId('prompt-use-case-lead')).toBeNull();
    expect(headings(container as HTMLElement)).toEqual(['Research', 'Creative', 'Overview']);
  });
});

describe('the canvas composer\'s next steps — a fixed list, never a model call', () => {
  it('offers nothing before the first turn', () => {
    renderWithPhase(<NextSteps conversationStarted={false} />, { phase: 'make' });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('offers the App surface its own list', () => {
    renderWithPhase(<NextSteps conversationStarted />, { phase: 'make' });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Polish the design', 'Make it work on phones', 'Add a section', 'Write real copy', 'Fix errors',
    ]);
  });

  it('falls back to the phase\'s starters on a surface without its own list', () => {
    renderWithPhase(<NextSteps conversationStarted surface="graph" />, { phase: 'measure' });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Define the key metric', 'Build a dashboard', 'Read an experiment',
    ]);
  });
});
