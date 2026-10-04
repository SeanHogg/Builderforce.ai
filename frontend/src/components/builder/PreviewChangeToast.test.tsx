import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { ProjectCheckpoint } from '@/lib/api';
import { PreviewChangeToast } from './PreviewChangeToast';
import type { ProjectVersions } from './useProjectVersions';

const version = (id: number, kind: ProjectCheckpoint['kind'], changed: string[] = []): ProjectCheckpoint => ({ id, kind, changed, fileCount: 3 });

function versionsOf(list: ProjectCheckpoint[] | null, restore = vi.fn(async () => ({ restored: [], removed: [], missing: [] }))): ProjectVersions {
  return { versions: list, error: false, save: vi.fn(), restore };
}

describe('PreviewChangeToast', () => {
  afterEach(() => cleanup());

  // A project's history is not news: nothing shows for the versions it opened with.
  it('says nothing about the versions the project opened with', () => {
    render(<PreviewChangeToast versions={versionsOf([version(2, 'auto', ['a']), version(1, 'baseline')])} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces an agent turn landing, and Undo restores the version before it', async () => {
    const restore = vi.fn(async () => ({ restored: [], removed: [], missing: [] }));
    const before = [version(2, 'auto', ['a']), version(1, 'baseline')];
    const { rerender } = render(<PreviewChangeToast versions={versionsOf(before, restore)} />);

    rerender(<PreviewChangeToast versions={versionsOf([version(3, 'auto', ['x', 'y', 'z']), ...before], restore)} />);
    expect(screen.getByRole('status').textContent).toMatch(/ide\.workspace\.changeLanded 3/);

    await act(async () => { fireEvent.click(screen.getByText('ide.workspace.undo')); });
    expect(restore).toHaveBeenCalledWith(2);

    // The restore adds a "before restore" version; the confirmation stays up regardless.
    rerender(<PreviewChangeToast versions={versionsOf([version(4, 'beforeRestore'), version(3, 'auto', ['x']), ...before], restore)} />);
    expect(screen.getByRole('status').textContent).toContain('ide.workspace.changeUndone');
  });

  it('ignores a new version that is not an agent turn', () => {
    const before = [version(1, 'baseline')];
    const { rerender } = render(<PreviewChangeToast versions={versionsOf(before)} />);
    rerender(<PreviewChangeToast versions={versionsOf([version(2, 'manual'), ...before])} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
