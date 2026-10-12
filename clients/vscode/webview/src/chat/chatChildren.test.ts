import { describe, expect, it, vi } from 'vitest';

// The bridge reaches for `acquireVsCodeApi` at load; these tests never post.
vi.mock('../vscodeBridge', () => ({ post: vi.fn() }));

import { childParticipants, childTarget, type ChildView } from './chatChildren';

/** A message for a live sub-agent goes to ITS run: by `@name`, or by the `#ticket` it works. */

const view = (over: Partial<ChildView>): ChildView => ({
  key: -1,
  handle: 'a1',
  name: 'Ada',
  label: 'port auth',
  owner: 'BuilderForce',
  ownerKey: 10,
  depth: 1,
  ...over,
});

describe('childParticipants', () => {
  it('makes each live child @-mentionable, telling apart two with one name', () => {
    const list = childParticipants([view({ key: -1, handle: 'a1' }), view({ key: -2, handle: 'a2' }), view({ key: -3, handle: 'a3', name: 'Bob' })]);
    expect(list.map((p) => p.name)).toEqual(['Ada-a1', 'Ada-a2', 'Bob']);
  });
});

describe('childTarget', () => {
  const children = [view({ key: -1, ticket: '2860' }), view({ key: -2, handle: 'a2', name: 'Bob', ticket: '2861' })];
  const [bob] = childParticipants(children).slice(1);

  it('routes an @-picked child to its run', () => {
    expect(childTarget('only the API half', bob!, children)?.key).toBe(-2);
  });

  it('routes a #ticket to the child working it', () => {
    expect(childTarget('#2860 skip the schema, Ada has it', null, children)?.key).toBe(-1);
  });

  it('leaves the chat\'s own run alone otherwise', () => {
    expect(childTarget('what is left?', null, children)).toBeNull();
    expect(childTarget('#999 status?', null, children)).toBeNull();
    expect(childTarget('hi', { kind: 'agent', ref: 'agent_12', name: 'Ada' }, children)).toBeNull();
  });
});
