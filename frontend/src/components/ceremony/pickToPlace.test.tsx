import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  CeremonyDropZone, CeremonyPickProvider, draggedTaskId, isFromNestedControl, placeKeyIntent, useCeremonyPick,
} from './pickToPlace';

// The real copy: the banner and the targets are found by the names a person hears.
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations'))
  .realCatalogIntlMock((await import('@/i18n/messages/en.json')).default as Record<string, unknown>));

/** A stand-in for the task card's Move button — the pick half of the gesture. */
function PickButton({ id, title }: { id: number; title: string }) {
  const pick = useCeremonyPick();
  return <button type="button" onClick={() => pick?.pick(id, title)}>{`pick ${title}`}</button>;
}

function Stage({ onAssign, onOpen = () => {}, enabled = true }: { onAssign: (id: number) => void; onOpen?: () => void; enabled?: boolean }) {
  return (
    <CeremonyPickProvider>
      <PickButton id={7} title="Fix login" />
      <CeremonyDropZone label="Assign to Ana" onPlace={onAssign} onClick={onOpen} enabled={enabled} style={{ padding: 8 }}>
        <span>Ana</span>
        <select aria-label="sprint"><option>S1</option></select>
      </CeremonyDropZone>
    </CeremonyPickProvider>
  );
}

describe('CeremonyDropZone — one drop path for drag, tap and keys', () => {
  it('places a TAPPED pick through the same handler a drop uses, then clears the pick', () => {
    const onAssign = vi.fn();
    render(<Stage onAssign={onAssign} />);
    fireEvent.click(screen.getByText('pick Fix login'));
    expect(screen.getByRole('status')).toHaveTextContent('Moving “Fix login”');

    fireEvent.click(screen.getByRole('button', { name: 'Assign to Ana' }));
    expect(onAssign).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('places a NATIVE drop through the same handler', () => {
    const onAssign = vi.fn();
    const { container } = render(<Stage onAssign={onAssign} />);
    const zone = container.querySelector('select')!.parentElement!;
    fireEvent.drop(zone, { dataTransfer: { getData: () => '42' } });
    expect(onAssign).toHaveBeenCalledWith(42);
  });

  it('drops with Enter or Space and cancels with Escape', () => {
    const onAssign = vi.fn();
    render(<Stage onAssign={onAssign} />);
    fireEvent.click(screen.getByText('pick Fix login'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Assign to Ana' }), { key: ' ' });
    expect(onAssign).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByText('pick Fix login'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign to Ana' })).toBeNull();
    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('cancels from the banner button', () => {
    render(<Stage onAssign={vi.fn()} />);
    fireEvent.click(screen.getByText('pick Fix login'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel move' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lets a nested control keep its meaning while a task is in hand', () => {
    const onAssign = vi.fn();
    render(<Stage onAssign={onAssign} />);
    fireEvent.click(screen.getByText('pick Fix login'));
    fireEvent.click(screen.getByLabelText('sprint'));
    expect(onAssign).not.toHaveBeenCalled();
  });

  it('is an ordinary container when nothing is picked, or when disabled', () => {
    const onOpen = vi.fn();
    const onAssign = vi.fn();
    const { unmount } = render(<Stage onAssign={onAssign} onOpen={onOpen} />);
    expect(screen.queryByRole('button', { name: 'Assign to Ana' })).toBeNull();
    fireEvent.click(screen.getByText('Ana'));
    expect(onOpen).toHaveBeenCalled();
    expect(onAssign).not.toHaveBeenCalled();
    unmount();

    render(<Stage onAssign={onAssign} enabled={false} />);
    fireEvent.click(screen.getByText('pick Fix login'));
    expect(screen.queryByRole('button', { name: 'Assign to Ana' })).toBeNull();
  });
});

describe('pick helpers', () => {
  it('reads only a real task id off a drag', () => {
    expect(draggedTaskId({ getData: () => '12' })).toBe(12);
    expect(draggedTaskId({ getData: () => '' })).toBeNull();
    expect(draggedTaskId({ getData: () => 'https://example.test' })).toBeNull();
    expect(draggedTaskId(null)).toBeNull();
  });

  it('maps keys to intents', () => {
    expect(placeKeyIntent('Enter')).toBe('place');
    expect(placeKeyIntent(' ')).toBe('place');
    expect(placeKeyIntent('Escape')).toBe('cancel');
    expect(placeKeyIntent('a')).toBeNull();
  });

  it('tells a nested control from the zone itself', () => {
    const zone = document.createElement('div');
    zone.setAttribute('role', 'button');
    const button = document.createElement('button');
    zone.appendChild(button);
    expect(isFromNestedControl(button, zone)).toBe(true);
    expect(isFromNestedControl(zone, zone)).toBe(false);
  });
});
