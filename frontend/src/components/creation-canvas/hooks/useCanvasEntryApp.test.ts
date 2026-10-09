import { describe, expect, it } from 'vitest';
import { entryAppDecision, type EntryAppFacts } from './useCanvasEntryApp';
import { phaseBefore } from './useCanvasLens';

const studioEntry: EntryAppFacts = {
  modality: 'designer', boardLoaded: true, canEdit: true, hasApp: false, hasCodeCards: false, failed: false, creating: false,
};

describe('entryAppDecision — the app a lens expects', () => {
  it('creates the app once the LOADED board has none, and holds the first turn meanwhile', () => {
    expect(entryAppDecision(studioEntry)).toEqual({ create: true, pending: true });
  });

  it('holds the first turn but creates nothing before the board has loaded', () => {
    // The starter seed is not the board: deciding "no app" about it is how a reload made a second one.
    expect(entryAppDecision({ ...studioEntry, boardLoaded: false })).toEqual({ create: false, pending: true });
  });

  it('does nothing on a board that already has an app — Back and reload are safe', () => {
    expect(entryAppDecision({ ...studioEntry, hasApp: true })).toEqual({ create: false, pending: false });
  });

  it('leaves code cards to the App surface, which turns them into the app itself', () => {
    expect(entryAppDecision({ ...studioEntry, hasCodeCards: true })).toEqual({ create: false, pending: false });
  });

  it('releases the first turn when the create fails, so the Brain can build it instead', () => {
    expect(entryAppDecision({ ...studioEntry, failed: true })).toEqual({ create: false, pending: false });
  });

  it('holds the first turn while its create is in flight, even after the lens stops expecting an app', () => {
    // Leaving Studio mid-create: releasing the turn now would let it make a second build.
    expect(entryAppDecision({ ...studioEntry, creating: true })).toEqual({ create: false, pending: true });
    expect(entryAppDecision({ ...studioEntry, modality: null, creating: true })).toEqual({ create: false, pending: true });
  });

  it('expects nothing from a lens with no app modality, or from a viewer who cannot edit', () => {
    expect(entryAppDecision({ ...studioEntry, modality: null })).toEqual({ create: false, pending: false });
    expect(entryAppDecision({ ...studioEntry, canEdit: false })).toEqual({ create: false, pending: false });
  });
});

describe('phaseBefore — the lens\'s phase floor', () => {
  it('lifts a board below the floor and leaves one at or past it alone', () => {
    expect(phaseBefore('idea', 'make')).toBe(true);
    expect(phaseBefore('make', 'make')).toBe(false);
    expect(phaseBefore('measure', 'make')).toBe(false);
  });
});
