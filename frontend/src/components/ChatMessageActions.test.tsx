import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMessageActions } from './ChatMessageActions';
import { downloadText } from '@/lib/download';

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }));
vi.mock('./ChatProjectActions', () => ({ ChatProjectActions: () => null }));
vi.mock('./brain/BrainMessageExport', () => ({ BrainMessageExport: () => null }));

describe('ChatMessageActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('puts an icon-only Markdown download on the assistant reply', () => {
    render(
      <ChatMessageActions
        assistantContent={'# Answer\n\nUseful detail.'}
        chatTitle="Research answer"
      />,
    );

    const markdown = screen.getByRole('button', { name: 'brain.messageActions.downloadMarkdown' });
    expect(markdown).toHaveTextContent('');

    fireEvent.click(markdown);
    expect(downloadText).toHaveBeenCalledWith(
      '# Answer\n\nUseful detail.',
      'research-answer.md',
      'text/markdown',
    );
    expect(screen.getByRole('button', { name: 'brain.messageActions.downloaded' }))
      .toHaveAttribute('data-state', 'complete');
  });

  /**
   * Copy moved into the shared <BrainTimeline>, so every surface that mounts the
   * transcript has it — the Canvas dock and the VS Code webview previously had none.
   * This bar must NOT offer a second one beside it.
   */
  it('no longer renders its own copy action', () => {
    render(<ChatMessageActions assistantContent="Answer" />);
    expect(screen.queryByRole('button', { name: 'brain.messageActions.copy' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'brain.messageActions.copied' })).toBeNull();
  });

  it('hides feedback when the host passes no handler', () => {
    render(<ChatMessageActions assistantContent="Answer" />);
    expect(screen.queryByRole('button', { name: 'brain.messageActions.thumbsUp' })).toBeNull();
  });
});
