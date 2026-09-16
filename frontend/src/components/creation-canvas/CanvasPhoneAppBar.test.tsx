import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CanvasPhoneAppBar } from './CanvasPhoneAppBar';

vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

const faces = [
  { userId: 'a', displayName: 'Ada Hogg' },
  { userId: 'b', displayName: 'Bob Hogg' },
  { userId: 'c', displayName: 'Cara Hogg' },
];

function renderBar(overrides: Partial<React.ComponentProps<typeof CanvasPhoneAppBar>> = {}) {
  return render(
    <CanvasPhoneAppBar
      title="Dog walking for towers"
      phase="idea"
      onPhaseChange={vi.fn()}
      surface="graph"
      onSurfaceChange={vi.fn()}
      roster={faces}
      boardMenu={<button type="button">More session actions</button>}
      {...overrides}
    />,
  );
}

describe('CanvasPhoneAppBar', () => {
  it('draws back, title, stage, roster and the board-menu host', () => {
    const onBack = vi.fn();
    renderBar({ onBack });

    expect(screen.getByTestId('canvas-app-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('canvas-app-bar-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Dog walking for towers')).toBeInTheDocument();
    expect(screen.getByTestId('canvas-app-bar-stage')).toHaveTextContent('Idea');
    expect(screen.getByTestId('canvas-app-bar-roster')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More session actions' })).toBeInTheDocument();
  });

  it('omits the back button when the host has no library to leave to', () => {
    renderBar();
    expect(screen.queryByTestId('canvas-app-bar-back')).toBeNull();
  });

  it('caps the roster faces at two and names the overflow', () => {
    renderBar();
    const roster = screen.getByTestId('canvas-app-bar-roster');
    expect(roster.textContent).toContain('AH');
    expect(roster.textContent).toContain('BH');
    expect(roster.textContent).not.toContain('CH');
    expect(roster.textContent).toMatch(/\+1/);
  });

  it('opens the phase stepper as a sheet from the title control', () => {
    renderBar();
    fireEvent.click(screen.getByTestId('canvas-app-bar-stage'));
    expect(screen.getByTestId('canvas-stage-sheet')).toBeInTheDocument();
  });
});
