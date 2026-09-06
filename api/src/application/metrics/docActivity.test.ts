import { describe, expect, it } from 'vitest';
import { scoreDocActivity } from './docActivity';

describe('scoreDocActivity', () => {
  it('weights authorship over edits over acknowledgements and ranks by the total', () => {
    const rows = scoreDocActivity(
      [
        { userId: 'u1', docsAuthored: 1, edits: 0, acksGiven: 0 },
        { userId: 'u2', docsAuthored: 0, edits: 2, acksGiven: 1 },
        { userId: 'u3', docsAuthored: 0, edits: 0, acksGiven: 2 },
      ],
      new Map([['u1', 'Ada'], ['u2', 'Grace']]),
    );
    expect(rows.map((r) => [r.name, r.score])).toEqual([['Grace', 5], ['Ada', 3], ['u3', 2]]);
  });

  it('falls back to the user id when no display name is known', () => {
    const [row] = scoreDocActivity([{ userId: 'u9', docsAuthored: 0, edits: 0, acksGiven: 0 }], new Map());
    expect(row).toMatchObject({ memberKind: 'human', memberRef: 'u9', name: 'u9', score: 0 });
  });
});
