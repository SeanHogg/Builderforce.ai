import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PromptSummary } from '@/lib/builderforceApi';
import { PromptsList } from './PromptsList';

// The global next-intl mock returns keys, so these assert WIRING: rows render
// through the shared Collection, the open handler fires, and the 'public' tab
// is read-only (no bulk-select checkboxes).

const prompt = (o: Partial<PromptSummary>): PromptSummary => ({
  id: 'p1', title: 'Alpha prompt', description: null, category: null, tags: [],
  usageCount: 1, starCount: 0, isFeatured: false, authorName: null, ...o,
}) as unknown as PromptSummary;

const prompts = [
  prompt({ id: 'p1', title: 'Alpha prompt', usageCount: 3 }),
  prompt({ id: 'p2', title: 'Beta prompt', usageCount: 9 }),
];

describe('PromptsList', () => {
  it('renders every prompt and no selection column on the public tab', () => {
    render(
      <PromptsList prompts={prompts} tab="public" search="" onSearchChange={() => {}} onOpen={() => {}} onReload={() => {}} />,
    );
    expect(screen.getByText('Alpha prompt')).toBeTruthy();
    expect(screen.getByText('Beta prompt')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('filters by the search prop', () => {
    render(
      <PromptsList prompts={prompts} tab="public" search="beta" onSearchChange={() => {}} onOpen={() => {}} onReload={() => {}} />,
    );
    expect(screen.queryByText('Alpha prompt')).toBeNull();
    expect(screen.getByText('Beta prompt')).toBeTruthy();
  });

  it('opens a prompt when its card is clicked', () => {
    const onOpen = vi.fn();
    render(
      <PromptsList prompts={prompts} tab="public" search="" onSearchChange={() => {}} onOpen={onOpen} onReload={() => {}} />,
    );
    fireEvent.click(screen.getByText('Alpha prompt'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });
});
