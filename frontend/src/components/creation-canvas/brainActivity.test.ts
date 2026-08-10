import { describe, expect, it } from 'vitest';
import type { BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
import {
  BRAIN_ACTIVITY_CYCLE_MS,
  brainActivityPhase,
  brainActivityTokens,
  brainActivityToolCount,
  brainRunSummary,
  formatElapsed,
  formatTokenCount,
  humanizeTraceLabel,
} from './brainActivity';
import {
  BRAIN_DOCK_MAX_WIDTH,
  BRAIN_DOCK_MIN_WIDTH,
  BRAIN_DOCK_WIDTH,
  brainDockReservedWidth,
  DEFAULT_BRAIN_DOCK_PREFERENCES,
  sanitizeBrainDockPreferences,
} from './brainDockPreferences';

const event = (over: Partial<BrainTraceEvent> & Pick<BrainTraceEvent, 'category' | 'label'>): BrainTraceEvent =>
  ({ ts: '2026-08-05T00:00:00.000Z', ...over });

describe('brainActivityPhase', () => {
  it('rotates the wording while nothing has been recorded yet, so it never reads as a hang', () => {
    expect(brainActivityPhase([], 0).id).toBe('thinking');
    expect(brainActivityPhase([], BRAIN_ACTIVITY_CYCLE_MS).id).toBe('processing');
    expect(brainActivityPhase([], BRAIN_ACTIVITY_CYCLE_MS * 2).id).toBe('churning');
    // The rotation wraps rather than freezing on the last word.
    expect(brainActivityPhase([], BRAIN_ACTIVITY_CYCLE_MS * 5).id).toBe('thinking');
  });

  it('names the tool being executed from the newest step', () => {
    const phase = brainActivityPhase([
      event({ category: 'llm', label: 'llm.complete' }),
      event({ category: 'tool', label: 'builtin_tasks_create' }),
    ], 900);
    expect(phase).toEqual({ id: 'executing', detail: 'tasks create' });
  });

  it('maps every recorded category to its own word', () => {
    expect(brainActivityPhase([event({ category: 'recall', label: 'evermind.recall' })], 0).id).toBe('recalling');
    expect(brainActivityPhase([event({ category: 'learn', label: 'evermind.learn' })], 0).id).toBe('learning');
    expect(brainActivityPhase([event({ category: 'reconcile', label: 'evermind.reconcile' })], 0).id).toBe('learning');
    expect(brainActivityPhase([event({ category: 'message', label: 'agent.message' })], 0).id).toBe('writing');
    expect(brainActivityPhase([event({ category: 'llm', label: 'llm.complete' })], 0).id).toBe('processing');
  });

  it('skips error steps so a failed tool does not silence the narration', () => {
    const phase = brainActivityPhase([
      event({ category: 'tool', label: 'canvas.add_object' }),
      event({ category: 'error', label: 'boom' }),
    ], 0);
    expect(phase).toEqual({ id: 'executing', detail: 'add object' });
  });
});

describe('humanizeTraceLabel', () => {
  it('drops the transport prefix and reads as words', () => {
    expect(humanizeTraceLabel('builtin_search_code')).toBe('search code');
    expect(humanizeTraceLabel('canvas.invoke_object_action')).toBe('invoke object action');
    expect(humanizeTraceLabel('llm.complete')).toBe('llm complete');
  });
});

describe('brainActivityTokens', () => {
  it('prefers a reported total and otherwise sums the split', () => {
    expect(brainActivityTokens([
      event({ category: 'llm', label: 'llm.complete', usage: { total: 1_200 } }),
      event({ category: 'llm', label: 'llm.complete', usage: { prompt: 300, completion: 40 } }),
      event({ category: 'tool', label: 'builtin_tasks_list' }),
    ])).toBe(1_540);
  });

  it('is zero when no step reported usage', () => {
    expect(brainActivityTokens([event({ category: 'tool', label: 'x' })])).toBe(0);
  });
});

describe('formatting', () => {
  it('formats tokens compactly enough for a one-line strip', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(940)).toBe('940');
    expect(formatTokenCount(1_240)).toBe('1.2k');
    expect(formatTokenCount(24_600)).toBe('25k');
    expect(formatTokenCount(1_400_000)).toBe('1.4M');
  });

  it('formats elapsed time the way the transcript does', () => {
    expect(formatElapsed(52_400)).toBe('52s');
    expect(formatElapsed(74_000)).toBe('1m 14s');
    expect(formatElapsed(120_000)).toBe('2m');
  });
});

describe('brainRunSummary', () => {
  it('reports duration, tokens, and executed actions once a turn settles', () => {
    expect(brainRunSummary([
      event({ category: 'llm', label: 'llm.complete', usage: { total: 800 } }),
      event({ category: 'tool', label: 'builtin_tasks_create' }),
    ], 52_000)).toEqual({ durationMs: 52_000, tokens: 800, toolCount: 1 });
    expect(brainActivityToolCount([event({ category: 'llm', label: 'llm.complete' })])).toBe(0);
  });

  it('returns nothing for an unmeasured run rather than a meaningless badge', () => {
    expect(brainRunSummary([], 0)).toBeNull();
  });
});

describe('sanitizeBrainDockPreferences', () => {
  it('falls back to the shipped default for anything unrecognized', () => {
    expect(sanitizeBrainDockPreferences(null)).toEqual(DEFAULT_BRAIN_DOCK_PREFERENCES);
    expect(sanitizeBrainDockPreferences({ side: 'top', size: 'huge', mode: 'popup', width: 'wide' })).toEqual(DEFAULT_BRAIN_DOCK_PREFERENCES);
  });

  it('keeps a stored layout the user actually chose', () => {
    expect(sanitizeBrainDockPreferences({ mode: 'inline', side: 'left', size: 'expanded', width: 480, showExecutionDetail: true, open: false }))
      .toEqual({ mode: 'inline', side: 'left', size: 'expanded', width: 480, showExecutionDetail: true, open: false });
  });

  it('migrates the retired floating placement to inline instead of dropping it', () => {
    // Someone who chose "floating" wanted a small Brain ON the board. That is now the
    // Brain Object itself — snapping them back to a full edge panel would silently
    // undo a layout choice they made on purpose.
    expect(sanitizeBrainDockPreferences({ mode: 'floating' }).mode).toBe('inline');
  });

  it('clamps a stored width so a bad value cannot swallow or hide the board', () => {
    expect(sanitizeBrainDockPreferences({ width: 40 }).width).toBe(BRAIN_DOCK_MIN_WIDTH);
    expect(sanitizeBrainDockPreferences({ width: 99_999 }).width).toBe(BRAIN_DOCK_MAX_WIDTH);
  });
});

describe('brainDockReservedWidth', () => {
  it('reserves board width for a docked Brain and none for an inline or closed one', () => {
    const docked = { ...DEFAULT_BRAIN_DOCK_PREFERENCES };
    expect(brainDockReservedWidth(docked)).toBe(BRAIN_DOCK_WIDTH.slim);
    expect(brainDockReservedWidth({ ...docked, size: 'expanded' })).toBe(BRAIN_DOCK_WIDTH.expanded);
    // A dragged width wins over the preset it started from.
    expect(brainDockReservedWidth({ ...docked, width: 412 })).toBe(412);
    // Inline IS an Object on the board and closed is not there at all.
    expect(brainDockReservedWidth({ ...docked, mode: 'inline' })).toBe(0);
    expect(brainDockReservedWidth({ ...docked, open: false })).toBe(0);
  });
});
