import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * The room speech bubble is the excerpt; the transcript holds the whole reply. When
 * the host can show that reply (`onSelect`), the bubble must be a real, named button
 * that fires once and does not let the same click reach the room's walk/select
 * listeners. When it cannot (a "thinking…" bubble, or no transcript surface), it must
 * stay inert text and never take the pointer from the scene.
 */

// `Html` portals into a WebGL scene; outside one it is just its children. The
// pointer-events prop is surfaced so the "never eats a click" contract is assertable.
vi.mock('@react-three/drei', () => ({
  Html: ({ children, pointerEvents }: { children: ReactNode; pointerEvents?: string }) => (
    <div data-testid="html-layer" data-pointer-events={pointerEvents}>{children}</div>
  ),
}));

import { PeerSpeechBubble } from './PeerSpeechBubble';

describe('PeerSpeechBubble', () => {
  it('is a named button that jumps to the reply, and swallows the click for the room', () => {
    const onSelect = vi.fn();
    const roomClick = vi.fn();
    const roomPointer = vi.fn();
    render(
      <div onClick={roomClick} onPointerDown={roomPointer}>
        <PeerSpeechBubble text="Eighteen months." pending={false} height={1.45} onSelect={onSelect} selectLabel="Show this reply in the chat" />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Eighteen months. — Show this reply in the chat' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('title')).toBe('Show this reply in the chat');
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(roomClick).not.toHaveBeenCalled();
    expect(roomPointer).not.toHaveBeenCalled();
    expect(screen.getByTestId('html-layer').getAttribute('data-pointer-events')).toBe('auto');
  });

  it('falls back to the excerpt as its name when the host gave no label', () => {
    render(<PeerSpeechBubble text="Done" pending={false} height={1} onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });

  it('renders inert text — no button, no pointer — when there is nothing to jump to', () => {
    render(<PeerSpeechBubble text="Thinking…" pending height={1.45} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Thinking…').tagName).toBe('P');
    expect(screen.getByTestId('html-layer').getAttribute('data-pointer-events')).toBe('none');
  });
});
