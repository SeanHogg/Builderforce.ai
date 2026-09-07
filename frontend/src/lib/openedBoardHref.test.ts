import { describe, it, expect } from 'vitest';
import { openedBoardHref } from './openedBoardHref';

describe('openedBoardHref', () => {
  it('omits focus entirely when there is no object to focus', () => {
    // The bug this file exists for: `?focus=null` on the navigation a person
    // makes immediately after converting their canvas into a project.
    expect(openedBoardHref({ sessionId: 'board-1', objectId: null })).toBe('/create/board-1');
    expect(openedBoardHref({ sessionId: 'board-1' })).toBe('/create/board-1');
  });

  it('focuses the object when the board has one', () => {
    expect(openedBoardHref({ sessionId: 'board-1', objectId: 'object-9' }))
      .toBe('/create/board-1?focus=object-9');
  });

  it('carries the extra flags a redirect forwards, dropping the empty ones', () => {
    expect(openedBoardHref(
      { sessionId: 'board-1', objectId: 'object-9' },
      { build: '1', prompt: null, chat: '', ticket: 'task:PRJ-3' },
    )).toBe('/create/board-1?focus=object-9&build=1&ticket=task%3APRJ-3');
  });

  it('encodes the session id rather than trusting it into the path', () => {
    expect(openedBoardHref({ sessionId: 'a b' })).toBe('/create/a%20b');
  });
});
