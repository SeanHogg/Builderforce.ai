import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import { buildLlmCourse, emptyCourse } from '@/lib/courseLms';
import type { CreationNodeData } from './types';

/**
 * Learning on the canvas: practise something, have the board remember how it
 * went, and be able to point a Course at your own subject.
 *
 * The regressions these cover, all measured 2026-08-13: a Course object created
 * from the palette was ALWAYS the shipped "Build an LLM" curriculum whatever it
 * was dragged out for; a module's knowledge check held its answer in `useState`
 * and forgot it the moment the card closed; and there was no practice object at
 * all, so nothing on the board could tell a learner what they keep missing.
 */

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'object-1', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const renderNode = (data: CreationNodeData, onEditData?: (id: string, patch: Partial<CreationNodeData>) => void) =>
  render(<CreationNode {...nodeProps} data={data} {...(onEditData ? { onEditData } : {})} />);

const PRACTICE: CreationNodeData = {
  kind: 'practice',
  title: 'Photosynthesis drill',
  practiceMode: 'quiz',
  questions: [
    { id: 'q1', prompt: 'Which organelle photosynthesises?', choices: ['Mitochondria', 'Chloroplast'], answerIndex: 1, explanation: 'Chloroplasts hold the chlorophyll.' },
    { id: 'q2', prompt: 'Which gas is released?', choices: ['Oxygen', 'Nitrogen'], answerIndex: 0 },
  ],
  attempts: [],
};

describe('a practice set is answered on its own card', () => {
  it('grades the answer, explains it, and records the attempt on the object', () => {
    const onEditData = vi.fn();
    renderNode(PRACTICE, onEditData);
    fireEvent.click(screen.getByRole('button', { name: /Mitochondria/ }));
    expect(screen.getByRole('status').textContent).toContain('Not quite.');
    expect(screen.getByRole('status').textContent).toContain('Chloroplasts hold the chlorophyll.');
    const [, patch] = onEditData.mock.calls[0]!;
    expect(patch.attempts).toHaveLength(1);
    expect(patch.attempts[0]).toMatchObject({ questionId: 'q1', correct: false, chosen: 0 });
  });

  it('shows what is still weak, from the attempts the object is carrying', () => {
    renderNode({ ...PRACTICE, attempts: [{ questionId: 'q1', correct: false, at: '2026-08-13T10:00:00.000Z' }] });
    expect(screen.getByText(/question\(s\) you missed last time/)).toBeTruthy();
    expect(screen.getByText('0 of 2 mastered')).toBeTruthy();
  });

  it('flips a card instead of offering choices in flashcard mode', () => {
    renderNode({ ...PRACTICE, practiceMode: 'flashcards' }, vi.fn());
    expect(screen.queryByRole('button', { name: /Mitochondria/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the answer' }));
    expect(screen.getByRole('button', { name: 'I knew it' })).toBeTruthy();
  });

  it('records nothing on a board this person cannot edit', () => {
    renderNode(PRACTICE);
    expect(screen.getByRole('button', { name: /Chloroplast/ })).toBeDisabled();
  });
});

describe('a course is pointed at a subject', () => {
  it('asks what to learn instead of arriving as somebody else s curriculum', () => {
    const onEditData = vi.fn();
    renderNode({ kind: 'course', title: 'New course', course: emptyCourse() }, onEditData);
    expect(screen.getByText('What do you want to learn?')).toBeTruthy();
    // The shipped worked example must NOT be what a blank course contains.
    expect(screen.queryByText(/Define the model/)).toBeNull();
    fireEvent.change(screen.getByLabelText('What do you want to learn?'), { target: { value: 'Photosynthesis' } });
    expect(onEditData.mock.calls[0]![1].course.subject).toBe('Photosynthesis');
  });

  it('keeps a knowledge-check answer on the object, with a score', () => {
    const course = buildLlmCourse();
    const onEditData = vi.fn();
    const { rerender } = renderNode({ kind: 'course', title: 'Build an LLM', course }, onEditData);
    fireEvent.click(screen.getByRole('button', { name: /Whenever prompts are inconvenient/ }));
    const [, patch] = onEditData.mock.calls[0]!;
    expect(patch.attempts[0]).toMatchObject({ questionId: 'foundations', correct: false });

    rerender(<CreationNode {...nodeProps} data={{ kind: 'course', title: 'Build an LLM', course, attempts: patch.attempts } as CreationNodeData} onEditData={onEditData} />);
    expect(screen.getByText(/Knowledge checks 0% \(1\/6\)/)).toBeTruthy();
  });
});

describe('a card with words on it can be listened to', () => {
  // jsdom has no speech synthesiser, and the control is deliberately absent
  // where the browser cannot speak — so the capability is stubbed to assert the
  // half that IS ours: which cards have words worth reading.
  beforeEach(() => {
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak: vi.fn(), cancel: vi.fn() },
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class { constructor(public text: string) {} lang = ''; },
    });
  });

  it('offers read-aloud on a document', () => {
    renderNode({ kind: 'document', title: 'Lab report', markdown: 'Photosynthesis converts light energy into chemical energy stored in sugars.' });
    expect(screen.getByRole('button', { name: /Read aloud/ })).toBeTruthy();
  });

  it('offers nothing to read on a card that is only a number', () => {
    renderNode({ kind: 'kpi', title: 'Revenue', value: 42, status: 'Live' } as CreationNodeData);
    expect(screen.queryByRole('button', { name: /Read aloud/ })).toBeNull();
  });
});
