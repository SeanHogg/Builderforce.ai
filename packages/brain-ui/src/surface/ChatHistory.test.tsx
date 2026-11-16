import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatHistoryList, ChatHistoryRow } from './ChatHistory';

/**
 * A refresh used to insert a flow-taking "Loading…" line above rows that were
 * already on screen, shoving every chat down. Once rows exist the list only
 * marks the region aria-busy — no status node, so scroll height does not change.
 */
describe('<ChatHistoryList> refresh does not shift the rows', () => {
  const row = <ChatHistoryRow chat={{ id: 1, title: 'The runway' }} active={false} onOpen={() => {}} />;

  it('does not insert a status line when rows are already shown', () => {
    const html = renderToStaticMarkup(
      <ChatHistoryList loading total={1}>{row}</ChatHistoryList>,
    );
    expect(html).toContain('role="list"');
    expect(html).toContain('The runway');
    // The region is busy, but nothing is added above the rows.
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain('bf-history__status');
    expect(html).not.toContain('Loading…');
  });

  it('still shows the loading line when there is nothing else on screen', () => {
    const html = renderToStaticMarkup(<ChatHistoryList loading total={0} />);
    expect(html).toContain('bf-history__status');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('bf-history__status--quiet');
    expect(html).not.toContain('role="list"');
  });

  it('shows empty / no-match only when the list has no rows and is not loading', () => {
    expect(renderToStaticMarkup(<ChatHistoryList total={0} />)).toContain('No chats yet');
    expect(renderToStaticMarkup(<ChatHistoryList total={3} />)).toContain('No chats match');
  });
});
