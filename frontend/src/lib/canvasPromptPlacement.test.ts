import { describe, expect, it } from 'vitest';
import { effectiveCanvasPromptPlacement, toggledCanvasPromptPlacement } from './canvasPromptPlacement';

const base = { hostOwnsSurface: false, brainIsSurface: false, preference: 'float' as const, brainDockDrawn: true };

describe('effectiveCanvasPromptPlacement', () => {
  it('closes the composer on a surface the embedding host owns', () => {
    expect(effectiveCanvasPromptPlacement({ ...base, hostOwnsSurface: true, lensPlacement: 'docked' })).toBe('closed');
  });

  it('keeps it floating while Brain IS the surface', () => {
    expect(effectiveCanvasPromptPlacement({ ...base, brainIsSurface: true, preference: 'docked' })).toBe('float');
  });

  it('floats a docked preference while no dock is drawn, and honours it while one is', () => {
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'docked', brainDockDrawn: false })).toBe('float');
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'docked' })).toBe('docked');
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'closed' })).toBe('closed');
  });

  it('lets a lens placement win over the stored preference while the dock is drawn', () => {
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'float', lensPlacement: 'docked' })).toBe('docked');
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'closed', lensPlacement: 'docked' })).toBe('docked');
  });

  it('falls back to the preference when the lens has nowhere to dock into', () => {
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'float', brainDockDrawn: false, lensPlacement: 'docked' })).toBe('float');
    expect(effectiveCanvasPromptPlacement({ ...base, preference: 'float', lensPlacement: null })).toBe('float');
  });
});

describe('toggledCanvasPromptPlacement', () => {
  it('closes an open prompt and re-opens a closed one floating', () => {
    expect(toggledCanvasPromptPlacement('docked')).toBe('closed');
    expect(toggledCanvasPromptPlacement('closed')).toBe('float');
  });
});
