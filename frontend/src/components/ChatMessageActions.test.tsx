import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageActions } from './ChatMessageActions';
import { downloadText } from '@/lib/download';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));
vi.mock('./ChatProjectActions', () => ({ ChatProjectActions: () => null }));
vi.mock('./brain/BrainMessageExport', () => ({ BrainMessageExport: () => null }));

describe('ChatMessageActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('puts icon-only Markdown and Copy actions on the assistant reply', () => {
    const onCopy = vi.fn();
    render(
      <ChatMessageActions
        onCopy={onCopy}
        assistantContent={'# Answer\n\nUseful detail.'}
        chatTitle="Research answer"
      />,
    );

    const markdown = screen.getByRole('button', { name: 'brain.messageActions.downloadMarkdown' });
    const copy = screen.getByRole('button', { name: 'brain.messageActions.copy' });
    expect(markdown).toHaveTextContent('');
    expect(copy).toHaveTextContent('');

    fireEvent.click(markdown);
    expect(downloadText).toHaveBeenCalledWith(
      '# Answer\n\nUseful detail.',
      'research-answer.md',
      'text/markdown',
    );
    expect(screen.getByRole('button', { name: 'brain.messageActions.downloaded' }))
      .toHaveAttribute('data-state', 'complete');

    fireEvent.click(copy);
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('changes the Copy icon accessible label after copying', () => {
    render(<ChatMessageActions onCopy={vi.fn()} copied assistantContent="Answer" />);
    expect(screen.getByRole('button', { name: 'brain.messageActions.copied' })).toBeTruthy();
  });
});
