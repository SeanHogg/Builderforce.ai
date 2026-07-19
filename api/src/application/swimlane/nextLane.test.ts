import { describe, it, expect } from 'vitest';
import { resolveNextLaneKey } from './nextLane';

const defaultBoard = [
  { key: 'backlog', position: 0 },
  { key: 'todo', position: 1 },
  { key: 'in_progress', position: 2 },
  { key: 'in_review', position: 3 },
  { key: 'done', position: 4, isTerminal: true },
];

describe('resolveNextLaneKey', () => {
  it('advances to the next WORKING lane by position on the default board', () => {
    expect(resolveNextLaneKey(defaultBoard, 'in_progress')).toBe('in_review');
    expect(resolveNextLaneKey(defaultBoard, 'todo')).toBe('in_progress');
  });

  it('does NOT auto-advance into the terminal Done lane (rests in the last working lane)', () => {
    // in_review's next is terminal → null → caller keeps in_review (review rest).
    expect(resolveNextLaneKey(defaultBoard, 'in_review')).toBeNull();
  });

  it('honours a CUSTOM working-lane order (renamed / re-ordered lanes)', () => {
    const custom = [
      { key: 'intake', position: 0 },
      { key: 'design', position: 1 },
      { key: 'build', position: 2 },
      { key: 'qa', position: 3 },
      { key: 'shipped', position: 4, isTerminal: true },
    ];
    expect(resolveNextLaneKey(custom, 'design')).toBe('build');
    expect(resolveNextLaneKey(custom, 'build')).toBe('qa');
    // qa's next is the terminal 'shipped' lane → not auto-advanced.
    expect(resolveNextLaneKey(custom, 'qa')).toBeNull();
  });

  it('sorts unordered input by position before resolving', () => {
    const shuffled = [
      { key: 'done', position: 4, isTerminal: true },
      { key: 'todo', position: 1 },
      { key: 'in_progress', position: 2 },
    ];
    expect(resolveNextLaneKey(shuffled, 'todo')).toBe('in_progress');
  });

  it('returns null for the last lane (nothing after it)', () => {
    expect(resolveNextLaneKey(defaultBoard, 'done')).toBeNull();
  });

  it('returns null when the current status is not a lane on the board', () => {
    expect(resolveNextLaneKey(defaultBoard, 'nonexistent')).toBeNull();
    expect(resolveNextLaneKey([], 'todo')).toBeNull();
  });
});
