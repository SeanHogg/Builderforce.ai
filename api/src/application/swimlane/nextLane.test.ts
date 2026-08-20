import { describe, it, expect } from 'vitest';
import { resolveNextLaneKey, resolveRunningLaneKey } from './nextLane';

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

describe('resolveNextLaneKey — parked lanes', () => {
  // The SHIPPED default board, which the fixtures above never modelled: `blocked` sits at
  // position 5, between in_review (4) and done (6). That layout is why a completing review
  // run advanced tickets INTO `blocked` on 10 of 13 production boards — and the sweep's
  // RUNNABLE_STATUSES excludes `blocked`, so nothing ever looked at them again.
  const defaultSeed = [
    { key: 'backlog', position: 0 },
    { key: 'todo', position: 1 },
    { key: 'ready', position: 2 },
    { key: 'in_progress', position: 3 },
    { key: 'in_review', position: 4 },
    { key: 'blocked', position: 5 },
    { key: 'done', position: 6, isTerminal: true },
  ];

  it('never advances a completing lane INTO the blocked lane', () => {
    expect(resolveNextLaneKey(defaultSeed, 'in_review')).not.toBe('blocked');
  });

  it('skips past blocked to reach the terminal lane, which still stops the advance', () => {
    // in_review → (skip blocked) → done is terminal → null, i.e. rest in review.
    expect(resolveNextLaneKey(defaultSeed, 'in_review')).toBeNull();
  });

  it('skips a parked lane to reach the next real WORKING lane', () => {
    const withWorkAfterParked = [
      { key: 'in_progress', position: 0 },
      { key: 'blocked', position: 1 },
      { key: 'in_review', position: 2 },
      { key: 'done', position: 3, isTerminal: true },
    ];
    expect(resolveNextLaneKey(withWorkAfterParked, 'in_progress')).toBe('in_review');
  });

  it('treats on_hold and cancelled as parked too', () => {
    const lanes = [
      { key: 'build', position: 0 },
      { key: 'on_hold', position: 1 },
      { key: 'cancelled', position: 2 },
      { key: 'qa', position: 3 },
    ];
    expect(resolveNextLaneKey(lanes, 'build')).toBe('qa');
  });

  it('resolves DETERMINISTICALLY when two lanes share a position', () => {
    // Measured live on board ad030733: `ready` and `todo` both at position 1, so the
    // advance target depended on row order. The key tie-break makes it stable.
    const collided = [
      { key: 'backlog', position: 0 },
      { key: 'todo', position: 1 },
      { key: 'ready', position: 1 },
      { key: 'in_progress', position: 2 },
    ];
    const shuffled = [collided[2]!, collided[0]!, collided[3]!, collided[1]!];
    expect(resolveNextLaneKey(collided, 'backlog')).toBe(resolveNextLaneKey(shuffled, 'backlog'));
    expect(resolveNextLaneKey(collided, 'backlog')).toBe('ready'); // 'ready' < 'todo'
  });
});

describe('resolveRunningLaneKey — the RUNNING hop, driven by the board', () => {
  const board = [
    { key: 'backlog', position: 0 },
    { key: 'todo', position: 1 },
    { key: 'ready', position: 2 },
    { key: 'in_progress', position: 3 },
    { key: 'in_review', position: 4 },
    { key: 'blocked', position: 5, isParking: true },
    { key: 'done', position: 6, isTerminal: true },
  ];

  it('prefers the lane the run was DISPATCHED FOR over the in_progress constant', () => {
    // A run dispatched to serve `ready` keeps the ticket in `ready` — it does not skip
    // two lanes to land on a constant.
    expect(resolveRunningLaneKey(board, 'todo', 'ready')).toBe('ready');
  });

  it('does not move a ticket already in the lane its run serves', () => {
    expect(resolveRunningLaneKey(board, 'ready', 'ready')).toBeNull();
  });

  it('falls back to in_progress when the run names no lane', () => {
    expect(resolveRunningLaneKey(board, 'backlog', null)).toBe('in_progress');
  });

  it('never rewinds: a run dispatched for an EARLIER lane leaves the ticket put', () => {
    expect(resolveRunningLaneKey(board, 'in_review', 'todo')).toBeNull();
  });

  it('moves nothing on a board with no in_progress lane and no dispatched lane', () => {
    // The defect this closes: writing `in_progress` here put the ticket in a status
    // matching no column, so it vanished from the board the moment work started.
    const custom = [
      { key: 'intake', position: 0 }, { key: 'spec', position: 1 },
      { key: 'build', position: 2 }, { key: 'ship', position: 3, isTerminal: true },
    ];
    expect(resolveRunningLaneKey(custom, 'intake', null)).toBeNull();
    expect(resolveRunningLaneKey(custom, 'intake', 'build')).toBe('build');
  });
});
