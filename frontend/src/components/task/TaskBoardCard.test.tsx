import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '@/lib/builderforceApi';
import { TaskBoardCard, type TaskBoardCardProps } from './TaskBoardCard';

// Wiring test: the status badge is a real button (keyboard reachable), clicking the card
// opens it, and clicking an agent chip opens the Agent tab without opening the card too.

const task = (o: Partial<Task> = {}): Task => ({
  id: 7, title: 'Fix login', status: 'todo', ...o,
} as Task);

const props = (o: Partial<TaskBoardCardProps> = {}): TaskBoardCardProps => ({
  task: task(),
  runs: [],
  cardStyle: {},
  fmt: {} as TaskBoardCardProps['fmt'],
  title: 'Fix login',
  statusLabel: 'To do',
  statusChoices: [{ value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }],
  editingStatus: false,
  flagged: false,
  participants: null,
  assigneeName: 'Bob',
  assigneeSelectValue: '',
  onDragStart: vi.fn(),
  onOpen: vi.fn(),
  onEditStatus: vi.fn(),
  onPatchStatus: vi.fn(),
  ...o,
});

describe('TaskBoardCard', () => {
  it('renders the title and a status badge that is a button', () => {
    render(<TaskBoardCard {...props()} />);
    expect(screen.getByText('Fix login')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To do' })).toBeTruthy();
  });

  it('clicking the status badge edits status without opening the card', () => {
    const p = props();
    render(<TaskBoardCard {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'To do' }));
    expect(p.onEditStatus).toHaveBeenCalledWith(true);
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it('clicking the card opens it', () => {
    const p = props();
    render(<TaskBoardCard {...p} />);
    fireEvent.click(screen.getByText('Fix login'));
    expect(p.onOpen).toHaveBeenCalledWith();
  });

  it('clicking an agent chip opens the Agent tab only', () => {
    const p = props({ runs: [{ key: 'k', label: 'Kevin', status: 'completed', execId: 3 }] });
    render(<TaskBoardCard {...p} />);
    fireEvent.click(screen.getByText('Kevin'));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    expect(p.onOpen).toHaveBeenCalledWith('agent');
  });

  it('shows a select instead of the badge while editing, and patches on change', () => {
    const p = props({ editingStatus: true });
    render(<TaskBoardCard {...p} />);
    expect(screen.queryByRole('button', { name: 'To do' })).toBeNull();
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Done' }));
    expect(p.onPatchStatus).toHaveBeenCalledWith('done');
    expect(p.onEditStatus).toHaveBeenCalledWith(false);
  });
});
