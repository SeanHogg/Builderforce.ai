import { describe, expect, it } from 'vitest';
import { ALL_ENTRY_POINTS, CLIENT_ENTRY_POINTS, parseRunOutcomeTelemetry, wireCost } from './index.js';

// The client wire: `cloud` is a label a server stamps on runs it scores itself, never one a
// client may claim (a client claiming it would double-count).
describe('entry points on the wire', () => {
  it('every client entry point is accepted, and cloud is the only one left out', () => {
    expect(ALL_ENTRY_POINTS).toContain('cloud');
    expect(CLIENT_ENTRY_POINTS).not.toContain('cloud');
    expect([...CLIENT_ENTRY_POINTS, 'cloud'].sort()).toEqual([...ALL_ENTRY_POINTS].sort());
    for (const entryPoint of CLIENT_ENTRY_POINTS) expect(parseRunOutcomeTelemetry({ entryPoint })).toEqual({ entryPoint });
  });

  it('drops entryPoint "cloud" off the wire, keeping the fields beside it', () => {
    expect(parseRunOutcomeTelemetry({ entryPoint: 'cloud', toolCalls: 3 })).toEqual({ toolCalls: 3 });
  });
});

describe('wireCost', () => {
  it('maps the row’s cost onto the door’s costMc, and a cost nobody reported stays absent', () => {
    expect(wireCost({ cost: 1_250 })).toEqual({ costMc: 1_250 });
    expect(wireCost({ cost: 0 })).toEqual({ costMc: 0 });
    expect(wireCost({})).toEqual({});
    expect(wireCost({ cost: -1 })).toEqual({});
    expect(wireCost({ cost: 1.5 })).toEqual({});
  });
});
