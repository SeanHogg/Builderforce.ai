import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Real English copy: a segment labelled "creationCanvas.composerIntent.captureIdea.label"
// tells nobody what pressing Enter will do, and what it does is the whole point of the
// control. One shared resolver, so this file cannot drift from the shipped catalog.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));
// `ChatInput` reaches for the router to open the ideation page from its own `/` menu.
// Rendered outside an app router there is none, exactly as `ChatInput.running.test` says.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import type { CanvasComposerIntentId } from '@/lib/canvasComposerIntents';
import { CanvasComposer } from './CanvasComposer';

/**
 * ONE COMPOSER, ONE MEANING PER SURFACE.
 *
 * The defect these guard is a screen with two text fields on it: the canvas's own
 * composer at the bottom and, on the Ideas surface, a capture form of the surface's own
 * eight hundred pixels above it — both asking for a sentence, neither saying which one
 * the Enter key belonged to. A surface contributes a VERB now, and the composer routes
 * the submit. So the properties worth pinning are: the choice is only drawn when there
 * IS one, Enter goes where the armed verb says, a viewer who cannot edit is never
 * offered a verb that writes, and changing surface does not leave the last surface's
 * verb armed under the new one's placeholder.
 */

function renderComposer(overrides: Partial<React.ComponentProps<typeof CanvasComposer>> = {}) {
  const props: React.ComponentProps<typeof CanvasComposer> = {
    placement: 'float',
    intents: ['captureIdea', 'ask'] as readonly CanvasComposerIntentId[],
    editable: true,
    onAsk: vi.fn(),
    onCaptureIdea: vi.fn(),
    input: { value: 'Dog walking for towers', onChange: vi.fn() },
    ...overrides,
  };
  const view = render(<CanvasComposer {...props} />);
  return { ...props, rerender: (next: Partial<React.ComponentProps<typeof CanvasComposer>>) => view.rerender(<CanvasComposer {...props} {...next} />) };
}

/** The box, by the name the ARMED verb gives it. */
const field = () => screen.getByRole('textbox');

describe('the one composer', () => {
  it('draws the verb only when the surface offers more than one', () => {
    const { rerender } = renderComposer();
    // Two verbs: a real choice, so a real control — and it reports itself as one, which
    // `aria-pressed` on two buttons could not (that allows "both on" and "neither on",
    // and this control can be in neither state).
    const group = screen.getByTestId('canvas-composer-intent');
    expect(group).toHaveAttribute('role', 'radiogroup');
    expect(screen.getByTestId('canvas-composer-intent-captureIdea')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('canvas-composer-intent-ask')).toHaveAttribute('aria-checked', 'false');

    // One verb: nothing to choose, so nothing is drawn. A segmented control with one
    // segment is a label wearing a control's chrome — the placeholder already says what
    // the field is for.
    rerender({ intents: ['ask'] });
    expect(screen.queryByTestId('canvas-composer-intent')).toBeNull();
  });

  it('names the box and its button after the armed verb', () => {
    renderComposer();
    // The scratchpad's default: a plain line is a card.
    expect(field()).toHaveAttribute('placeholder', 'Jot an idea. Enter captures it as a card; Ask Brain sends it to Brain instead.');
    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('canvas-composer-intent-ask'));
    expect(field()).toHaveAttribute('placeholder', 'Ask Brain about this canvas');
    expect(screen.getByRole('button', { name: 'Send to Brain' })).toBeInTheDocument();
  });

  it('routes Enter to the armed verb, and only to it', () => {
    const { onAsk, onCaptureIdea } = renderComposer();

    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onCaptureIdea).toHaveBeenCalledWith('Dog walking for towers');
    expect(onAsk).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('canvas-composer-intent-ask'));
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onAsk).toHaveBeenCalledWith('Dog walking for towers');
    // The capture handler was not called a second time: one line, one meaning.
    expect(onCaptureIdea).toHaveBeenCalledTimes(1);
  });

  /** Send and Enter are ONE branch inside the composer — the two can never disagree
   *  about what a line meant, which is the whole reason the verb is drawn on screen. */
  it('routes the send button the same way it routes Enter', () => {
    const { onCaptureIdea } = renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }));
    expect(onCaptureIdea).toHaveBeenCalledWith('Dog walking for towers');
  });

  it('never submits an empty or blank line', () => {
    const { onAsk, onCaptureIdea } = renderComposer({ input: { value: '   ', onChange: vi.fn() } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onCaptureIdea).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  /** A viewer who cannot change the board must not be offered a verb whose only outcome
   *  would be a silent no — the offer narrows rather than the button being drawn dead. */
  it('withdraws the writing verb from a viewer who cannot edit', () => {
    const { onCaptureIdea, onAsk } = renderComposer({ editable: false });
    expect(screen.queryByTestId('canvas-composer-intent')).toBeNull();
    expect(field()).toHaveAttribute('placeholder', 'Ask Brain about this canvas');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onCaptureIdea).not.toHaveBeenCalled();
    expect(onAsk).toHaveBeenCalledWith('Dog walking for towers');
  });

  /**
   * THE RESET THAT MAKES SURFACES SAFE. Arming Ask on the scratchpad and then leaving it
   * must not carry that choice onto a surface that never offered a choice — and coming
   * back must land on the scratchpad's own default rather than on whatever was pressed
   * three surfaces ago.
   */
  it('resets to the surface default when the offer changes', () => {
    const { rerender } = renderComposer();
    fireEvent.click(screen.getByTestId('canvas-composer-intent-ask'));
    expect(screen.getByTestId('canvas-composer-intent-ask')).toHaveAttribute('aria-checked', 'true');

    rerender({ intents: ['ask'] });
    expect(screen.queryByTestId('canvas-composer-intent')).toBeNull();

    rerender({ intents: ['captureIdea', 'ask'] });
    expect(screen.getByTestId('canvas-composer-intent-captureIdea')).toHaveAttribute('aria-checked', 'true');
  });

  /**
   * THE PHONE BRAIN SHEET'S ASSERTION. Opening the conversation means you are talking to
   * it, so a line typed with the sheet open must not land silently on the board as a
   * card. It is a PREFERENCE and not a set: withdrawing it hands the surface's own
   * default back rather than leaving Ask armed for ever.
   */
  it('arms the preferred verb while the host asks for it, and restores the default after', () => {
    const { rerender } = renderComposer();
    rerender({ preferIntent: 'ask' });
    expect(screen.getByTestId('canvas-composer-intent-ask')).toHaveAttribute('aria-checked', 'true');

    rerender({});
    expect(screen.getByTestId('canvas-composer-intent-captureIdea')).toHaveAttribute('aria-checked', 'true');
  });

  /**
   * The phone's whole command bar rides in the composer's leading slot. It is a NODE the
   * host supplies rather than a flag, because the sheet, its state and its handlers all
   * belong to the host — this only gives it the slot in front of the field.
   */
  it('gives the host a slot in front of the field', () => {
    renderComposer({ leading: <button type="button">Actions</button> });
    expect(screen.getByRole('button', { name: 'Actions' })).toBeInTheDocument();
  });

  /** Docked into the Brain panel the composer is that panel's last row, so it draws
   *  neither its own header nor the run receipt the panel's footer already narrates. */
  it('drops its own chrome when it is docked into the Brain panel', () => {
    renderComposer({
      placement: 'docked',
      activity: <p>Executing</p>,
      dockControls: { docked: true, onToggleDock: vi.fn(), onClose: vi.fn() },
    });
    expect(screen.getByTestId('canvas-composer')).toHaveAttribute('data-placement', 'docked');
    expect(screen.queryByTestId('canvas-prompt-dock')).toBeNull();
    expect(screen.queryByTestId('canvas-prompt-close')).toBeNull();
    expect(screen.queryByText('Executing')).toBeNull();
  });
});
