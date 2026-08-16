import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import { PromptUseCasePicker } from './PromptUseCasePicker';
import { C_SUITE_CANVAS_OWNERS, C_SUITE_CANVAS_USE_CASES, C_SUITE_CANVAS_WORKFLOWS, cSuiteCanvasOwner, cSuiteCanvasWorkflow, executiveCanvasPrompt } from '@/lib/templates/promptUseCases';

// The picker now renders the merged catalogue, whose workspace half comes from
// the API. These tests are about the picker and the prompt sources, so the
// installable half is stubbed empty — its own behaviour is covered by the
// gallery and the server's template tests.
vi.mock('@/lib/templates/api', () => ({
  templatesApi: { list: () => Promise.resolve({ templates: [], categories: [] }) },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(
    (key: string) => ({ tabLabel: 'Choose a starting point', heading: 'What should we create?' })[key] ?? key,
    { raw: () => [
      { id: 'wireframe', category: 'apps', label: 'Wireframe', prompt: 'Create a product wireframe.' },
      { category: 'creative', label: 'Animation', prompt: 'Create an animation concept.' },
    ] },
  ),
}));

describe('PromptUseCasePicker', () => {
  it('maps every legacy C-suite contract into the Creation Canvas menu exactly once', () => {
    const ids = C_SUITE_CANVAS_USE_CASES.map((item) => item.id);

    expect(ids).toHaveLength(48);
    expect(new Set(ids).size).toBe(48);
    expect(ids).toContain('agile.sprint.current');
    expect(ids).toContain('finance.runway.snapshot');
    expect(ids).toContain('governance.snapshot');
    expect(ids).toContain('investor.market.delete_peer');
    expect(ids).toContain('research.web_search');
    expect(ids).toContain('scratchpad.create_deck');
    expect(C_SUITE_CANVAS_USE_CASES.every((item) => item.categoryLabel && item.prompt.length > 80)).toBe(true);
    expect(C_SUITE_CANVAS_USE_CASES.every((item) => cSuiteCanvasOwner(item) !== null)).toBe(true);
    const supportedKinds = new Set<string>(CREATION_OBJECT_KINDS);
    expect(Object.values(C_SUITE_CANVAS_OWNERS).flatMap((owner) => owner.objects).every((kind) => supportedKinds.has(kind))).toBe(true);
    const ideaToRealStages = new Set(['idea', 'make', 'run', 'measure']);
    expect(Object.values(C_SUITE_CANVAS_OWNERS).flatMap((owner) => owner.stages).every((stage) => ideaToRealStages.has(stage))).toBe(true);
  });

  it('gives all 48 use cases an executable evidence, mutation, output, and completion contract', () => {
    const ids = C_SUITE_CANVAS_USE_CASES.map((item) => item.id);

    expect(Object.keys(C_SUITE_CANVAS_WORKFLOWS).sort()).toEqual([...ids].sort());
    for (const item of C_SUITE_CANVAS_USE_CASES) {
      const owner = cSuiteCanvasOwner(item)!;
      const workflow = cSuiteCanvasWorkflow(item)!;
      expect(['domain', 'canvas', 'web']).toContain(workflow.evidence);
      expect(workflow.outputs.length).toBeGreaterThan(0);
      expect(workflow.outputs.every((kind) => owner.objects.includes(kind as never))).toBe(true);
      expect(workflow.completion.length).toBeGreaterThan(40);
      if (workflow.evidence === 'domain') expect(workflow.entityTerms.length).toBeGreaterThan(0);
      expect(executiveCanvasPrompt(item)).toContain(`canvas_prepare_executive_use_case with useCaseId "${item.id}"`);
      expect(executiveCanvasPrompt(item)).toContain(workflow.completion);
      expect(executiveCanvasPrompt(item)).toContain('Do not propose a new database table');
    }
  });

  it('renders the tab above a constrained prompt and returns the selected prescription', () => {
    const onSelect = vi.fn();
    const { container } = render(<PromptUseCasePicker placement="top" onSelect={onSelect} />);
    const root = container.firstElementChild!;
    const tab = screen.getByRole('button', { name: 'Choose a starting point' });

    expect(root.lastElementChild).toBe(tab);
    expect(root).toHaveAttribute('data-open', 'false');
    expect(screen.getByText('Wireframe').closest('button')).toHaveAttribute('tabindex', '-1');

    fireEvent.click(tab);
    expect(root).toHaveAttribute('data-open', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Wireframe' }));

    // One argument now: the ENTRY. The caller decides what to do with it, which
    // is what lets the same menu seed a prompt, drop a pack and open a setup.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'wireframe',
      name: 'Wireframe',
      action: { kind: 'prompt', prompt: 'Create a product wireframe.' },
    }));
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes an expanded list with Escape', () => {
    render(<PromptUseCasePicker placement="bottom" onSelect={vi.fn()} />);
    const tab = screen.getByRole('button', { name: 'Choose a starting point' });
    fireEvent.click(tab);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it('searches across the larger supported catalog', () => {
    render(<PromptUseCasePicker placement="bottom" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a starting point' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'animation' } });
    expect(screen.getByRole('button', { name: 'Animation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wireframe' })).not.toBeInTheDocument();
  });

  it('finds a migrated feature by its legacy dotted contract and returns its Canvas prescription', () => {
    const onSelect = vi.fn();
    render(<PromptUseCasePicker placement="bottom" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose a starting point' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'finance.runway.snapshot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Runway snapshot' }));

    // The execution contract now rides ON the entry rather than being composed
    // at the call site, so every surface offering it runs the same prompt.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      id: 'finance.runway.snapshot',
      categoryLabel: 'Finance',
      action: expect.objectContaining({
        kind: 'prompt',
        prompt: expect.stringContaining('canvas_prepare_executive_use_case'),
      }),
    }));
  });
});
