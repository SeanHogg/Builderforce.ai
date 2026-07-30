import { describe, it, expect } from 'vitest';
import { selectPendingAskUser, serializeAskUser, askUserAnchorId } from './askUser';

/** A message in the shape selectPendingAskUser reads (id/role/content). */
const msg = (id: number, role: string, content: string) => ({ id, role, content });

const QUESTION = serializeAskUser({
  question: 'Which database?',
  options: [{ label: 'Postgres' }, { label: 'SQLite' }],
});

describe('selectPendingAskUser', () => {
  it('returns null for an empty transcript', () => {
    expect(selectPendingAskUser([])).toBeNull();
  });

  it('returns null when no assistant turn asked anything', () => {
    expect(selectPendingAskUser([msg(1, 'user', 'hi'), msg(2, 'assistant', 'hello')])).toBeNull();
  });

  it('finds the question the chat is blocked on', () => {
    const pending = selectPendingAskUser([
      msg(1, 'user', 'set up the db'),
      msg(2, 'assistant', `Sure.\n\n${QUESTION}`),
    ]);
    expect(pending?.messageId).toBe(2);
    expect(pending?.payload.question).toBe('Which database?');
    expect(pending?.payload.options.map((o) => o.label)).toEqual(['Postgres', 'SQLite']);
  });

  it('is answered once a user turn follows it — nothing pending', () => {
    expect(
      selectPendingAskUser([
        msg(1, 'user', 'set up the db'),
        msg(2, 'assistant', QUESTION),
        msg(3, 'user', 'Postgres'),
      ]),
    ).toBeNull();
  });

  it('re-blocks on a NEWER question asked after an earlier one was answered', () => {
    const second = serializeAskUser({ question: 'Which ORM?', options: [{ label: 'Drizzle' }, { label: 'Prisma' }] });
    const pending = selectPendingAskUser([
      msg(1, 'assistant', QUESTION),
      msg(2, 'user', 'Postgres'),
      msg(3, 'assistant', second),
    ]);
    expect(pending?.messageId).toBe(3);
    expect(pending?.payload.question).toBe('Which ORM?');
  });

  it('looks past non-user turns (tool/step) that follow the question', () => {
    const pending = selectPendingAskUser([
      msg(1, 'assistant', QUESTION),
      msg(2, 'tool', 'some tool output'),
    ]);
    expect(pending?.messageId).toBe(1);
  });

  it('ignores an assistant turn whose ask-user block is malformed', () => {
    expect(selectPendingAskUser([msg(1, 'assistant', '```ask-user\nnot json\n```')])).toBeNull();
  });

  it('anchors a card to its message so a host can scroll to exactly that question', () => {
    const pending = selectPendingAskUser([msg(7, 'assistant', QUESTION)]);
    expect(askUserAnchorId(pending!.messageId)).toBe('bf-ask-7');
  });
});
