import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { TemplateEntry } from '@/lib/templates/contract';
import { categoryServesPhase } from '@/lib/canvasPhaseStarters';
import { renderWithPhase } from '../phase/testPhaseProvider';
import { CanvasPromptStarter } from './CanvasPromptStarter';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/**
 * The catalogue, held to three categories whose phase is known from the C-suite owner
 * table: Research serves Idea only, Overview serves Measure only, and `creative` has no
 * owner at all. Stubbed because what is under test is the ORDER the composer gives them,
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

function starter(overrides: Partial<React.ComponentProps<typeof CanvasPromptStarter>> = {}) {
  return (
    <CanvasPromptStarter
      open
      onOpenChange={vi.fn()}
      conversationStarted={false}
      onPrompt={vi.fn()}
      onTwilioJourney={vi.fn()}
      onPack={vi.fn()}
      {...overrides}
    />
  );
}

/** Section headings in the order the list draws them. */
const headings = (root: HTMLElement) => [...root.querySelectorAll('section')].map((section) => section.firstElementChild?.textContent);

describe('the composer\'s starting points, led by the phase (PRD 32 · W8)', () => {
  it('reads the fixture categories the way the owner table does', () => {
    expect(categoryServesPhase('executiveOverview', 'measure')).toBe(true);
    expect(categoryServesPhase('executiveResearch', 'measure')).toBe(false);
    expect(categoryServesPhase('executiveResearch', 'idea')).toBe(true);
    expect(categoryServesPhase('creative', 'idea')).toBe(false);
  });

  it('names the phase on the trigger', () => {
    renderWithPhase(starter(), { phase: 'measure' });
    expect(screen.getByTestId('canvas-prompt-starter-trigger')).toHaveTextContent('Starting points · Measure');
  });

  it('leads with the phase\'s three starters, then the use cases that serve it, then the rest', () => {
    const { container } = renderWithPhase(starter(), { phase: 'measure' });
    const lead = screen.getByTestId('prompt-use-case-lead');
    expect(within(lead).getAllByRole('button').map((button) => button.lastElementChild?.textContent)).toEqual([
      'Define the key metric',
      'Build a dashboard',
      'Read an experiment',
    ]);
    // Overview serves Measure and moves ahead; the other two keep the catalogue's order.
    expect(headings(container as HTMLElement)).toEqual(['Starting points · Measure', 'Overview', 'Research', 'Creative']);
  });

  it('orders by the CURRENT phase — the same catalogue reads differently in Idea', () => {
    const { container } = renderWithPhase(starter(), { phase: 'idea' });
    expect(within(screen.getByTestId('prompt-use-case-lead')).getAllByRole('button')[0]).toHaveTextContent('Capture the idea');
    expect(headings(container as HTMLElement)).toEqual(['Starting points · Idea', 'Research', 'Creative', 'Overview']);
  });

  it('seeds the composer with a starter\'s prompt and closes the list — it never sends', () => {
    const onPrompt = vi.fn();
    const onOpenChange = vi.fn();
    renderWithPhase(starter({ onPrompt, onOpenChange }), { phase: 'measure' });
    fireEvent.click(within(screen.getByTestId('prompt-use-case-lead')).getByRole('button', { name: 'Define the key metric' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onPrompt).toHaveBeenCalledWith('Define the one metric that says whether this app is working, with a target, and put it on the board.');
  });

  it('drops the lead while searching, so a query reads the whole catalogue', () => {
    renderWithPhase(starter(), { phase: 'measure' });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'animation' } });
    expect(screen.queryByTestId('prompt-use-case-lead')).toBeNull();
    expect(screen.getByRole('button', { name: 'Animation' })).toBeInTheDocument();
  });

  it('keeps the plain list and wording outside a canvas', () => {
    const { container } = render(starter());
    expect(screen.getByTestId('canvas-prompt-starter-trigger')).toHaveTextContent(/^Starting points$/);
    expect(screen.queryByTestId('prompt-use-case-lead')).toBeNull();
    expect(headings(container as HTMLElement)).toEqual(['Research', 'Creative', 'Overview']);
  });
});
