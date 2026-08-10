import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatModeToggle } from './ChatModeToggle';
import { WorkOptionsPicker } from './WorkOptionsPicker';
import { workOptions } from '@/lib/brain';
import en from '@/i18n/messages/en.json';

// The global next-intl mock returns the KEY, not the copy (see src/test/setup.ts),
// so component tests assert wiring by key and the copy itself is asserted against
// the catalogue below — which is where it actually lives.

describe('ChatModeToggle', () => {
  it('exposes both modes as a radio group with the armed one checked', () => {
    render(<ChatModeToggle value="chat" onChange={() => {}} />);

    expect(screen.getByRole('radiogroup', { name: 'brain.modes.pickerAria' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'brain.modes.chat.label' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'brain.modes.work.label' }).getAttribute('aria-checked')).toBe('false');
  });

  it('reports a switch, and does not re-fire for the mode already armed', () => {
    const onChange = vi.fn();
    render(<ChatModeToggle value="chat" onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'brain.modes.chat.label' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: 'brain.modes.work.label' }));
    expect(onChange).toHaveBeenCalledWith('work');
  });
});

describe('WorkOptionsPicker', () => {
  it('renders nothing in chat mode', () => {
    // Self-gating: the host renders it unconditionally and the component decides.
    const { container } = render(<WorkOptionsPicker mode="chat" onPick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('offers every registered work starting point in work mode', () => {
    render(<WorkOptionsPicker mode="work" onPick={() => {}} />);
    expect(screen.getByRole('group', { name: 'brain.workOptions.pickerAria' })).toBeTruthy();
    for (const option of workOptions()) {
      expect(screen.getByText(`brain.workOptions.${option.id}.label`)).toBeTruthy();
    }
  });

  it('hands back the option id and its brief', () => {
    const onPick = vi.fn();
    render(<WorkOptionsPicker mode="work" onPick={onPick} />);

    fireEvent.click(screen.getByText('brain.workOptions.audit_spreadsheet.label'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]).toEqual(['audit_spreadsheet', 'brain.workOptions.audit_spreadsheet.brief']);
  });
});

describe('work option catalogue', () => {
  // `brain.workOptions` also holds two loose strings (pickerAria/tilesHint) beside the
  // per-option objects, so it is read through `unknown` rather than asserted to be a
  // uniform record — the lookups below are keyed by real option ids either way.
  const catalogue = (en.brain.workOptions as unknown) as Record<string, { label: string; hint: string; brief: string }>;

  it('gives every registered option a label, a hint and a brief', () => {
    for (const option of workOptions()) {
      const entry = catalogue[option.id];
      expect(entry, `missing copy for ${option.id}`).toBeTruthy();
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.hint.length).toBeGreaterThan(0);
    }
  });

  it('every brief is a COMPLETE delegation, not a topic', () => {
    // The whole point of the tiles: a one-line seed ("audit my spreadsheet") produces a
    // turn that asks three clarifying questions instead of doing the work. A brief that
    // drifts back to a short label would silently reintroduce that.
    for (const option of workOptions()) {
      expect(catalogue[option.id].brief.length, `${option.id} brief is too short to act on`).toBeGreaterThan(120);
    }
  });
});
