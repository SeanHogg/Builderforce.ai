import { describe, expect, it } from 'vitest';
import { recordedPreflight } from './preflightRecorded';
import type { RunCell } from '../runStore/runCell';

const FLASH = 'google/gemini-2.5-flash';

describe('recordedPreflight facts', () => {
  it('carries the host plan model only before code changed and snapshots the unresolved accounts', () => {
    const cell = { byoUnresolved: ['anthropic:expired'], codeChanged: false } as RunCell;
    const facts = recordedPreflight(cell, FLASH);
    expect(facts).toEqual({ byoUnresolved: ['anthropic:expired'], planModel: FLASH });
    cell.byoUnresolved.push('openai:revoked');
    expect(facts.byoUnresolved).toEqual(['anthropic:expired']);
    cell.codeChanged = true;
    expect(recordedPreflight(cell, FLASH)).toEqual({ byoUnresolved: cell.byoUnresolved });
    expect(recordedPreflight(cell, undefined)).not.toHaveProperty('planModel');
  });
});
