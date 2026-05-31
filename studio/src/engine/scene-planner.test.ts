import { describe, it, expect } from 'vitest';
import {
  planScene,
  cameraMoveToMotion,
  composeShotPrompt,
  normaliseShotBudget,
  storyboardFrameCount,
} from './scene-planner';
import type { BuilderforceClient } from '@seanhogg/builderforce-sdk';
import type { CharacterBible, PlannedShot } from '../types';

/**
 * The planner's value is structural: it must (a) thread character appearances
 * into shot prompts for consistency, (b) clamp hallucinated camera moves, (c)
 * hand the engine a frame budget that sums EXACTLY to the requested total, and
 * (d) always return an executable storyboard even when the LLM misbehaves.
 * These invariants are what the engine depends on, so they're locked here.
 */

/** Build a fake BuilderforceClient that returns canned JSON per call, in order. */
function mockClient(responses: string[]): BuilderforceClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const content = responses[Math.min(i, responses.length - 1)];
          i++;
          return { choices: [{ message: { content } }] };
        },
      },
    },
  } as unknown as BuilderforceClient;
}

const DIRECTOR = JSON.stringify({
  treatment: 'A misty valley at dawn, cold blue palette, slow cinematic arc.',
  characters: [
    { id: 'char-1', name: 'Knight', appearance: 'tall knight in dented steel armour, grey cloak' },
  ],
});

describe('planScene (Director → Shot Planner pipeline)', () => {
  it('produces a storyboard whose frame budget sums exactly to totalFrames', async () => {
    const shots = JSON.stringify({
      shots: [
        { id: 's1', prompt: 'valley wide shot', characterIds: ['char-1'], camera: 'pan-right', action: 'walking', durationFrames: 3 },
        { id: 's2', prompt: 'dragon reveal', characterIds: [], camera: 'tilt-up', action: 'looking up', durationFrames: 5 },
      ],
    });
    const client = mockClient([DIRECTOR, shots]);
    const sb = await planScene({ apiKey: 'k', request: 'knight finds dragon', totalFrames: 24 }, client);

    expect(sb.shots.reduce((a, s) => a + s.durationFrames, 0)).toBe(24);
    expect(sb.characters).toHaveLength(1);
    expect(sb.treatment).toMatch(/misty valley/i);
  });

  it('clamps a hallucinated camera move to static and drops unknown character ids', async () => {
    const shots = JSON.stringify({
      shots: [
        { id: 's1', prompt: 'a shot', characterIds: ['char-1', 'ghost-99'], camera: 'orbit-360', action: '', durationFrames: 2 },
      ],
    });
    const sb = await planScene(
      { apiKey: 'k', request: 'x', totalFrames: 10 },
      mockClient([DIRECTOR, shots]),
    );
    expect(sb.shots[0].camera).toBe('static');
    expect(sb.shots[0].characterIds).toEqual(['char-1']); // ghost-99 dropped
  });

  it('falls back to one full-length shot when the planner returns no shots', async () => {
    const sb = await planScene(
      { apiKey: 'k', request: 'x', totalFrames: 12 },
      mockClient([DIRECTOR, JSON.stringify({ shots: [] })]),
    );
    expect(sb.shots).toHaveLength(1);
    expect(sb.shots[0].durationFrames).toBe(12);
  });

  it('salvages JSON wrapped in prose (model ignored json_schema)', async () => {
    const sb = await planScene(
      { apiKey: 'k', request: 'x', totalFrames: 8 },
      mockClient([`Sure! Here you go: ${DIRECTOR} — enjoy.`, JSON.stringify({ shots: [] })]),
    );
    expect(sb.characters[0].name).toBe('Knight');
  });
});

describe('composeShotPrompt (character-consistency threading)', () => {
  const chars: CharacterBible[] = [
    { id: 'char-1', name: 'Knight', appearance: 'dented steel armour, grey cloak' },
    { id: 'char-2', name: 'Mage', appearance: 'blue robes, white beard' },
  ];
  const shot: PlannedShot = {
    id: 's1', prompt: 'a windswept ridge at dusk', characterIds: ['char-1', 'char-2'],
    camera: 'static', action: '', durationFrames: 4,
  };

  it('appends every referenced character appearance to the prompt', () => {
    const p = composeShotPrompt(shot, chars);
    expect(p).toContain('windswept ridge');
    expect(p).toContain('dented steel armour');
    expect(p).toContain('blue robes');
  });

  it('returns the bare prompt when no characters are referenced', () => {
    expect(composeShotPrompt({ ...shot, characterIds: [] }, chars)).toBe(shot.prompt);
  });
});

describe('storyboardFrameCount (cinematic progress denominator)', () => {
  const shotOf = (id: string, durationFrames: number): PlannedShot => ({
    id, prompt: id, characterIds: [], camera: 'static', action: '', durationFrames,
  });

  it('sums durationFrames across shots — the real total the engine renders', () => {
    const sb = { treatment: '', characters: [], shots: [shotOf('a', 10), shotOf('b', 12), shotOf('c', 14), shotOf('d', 14)] };
    // The exact bug from the field report: input `frames` was 16 but the edited
    // storyboard sums to 50 — the progress bar must use THIS, not the input.
    expect(storyboardFrameCount(sb)).toBe(50);
  });

  it('is zero for an empty storyboard (no shots)', () => {
    expect(storyboardFrameCount({ treatment: '', characters: [], shots: [] })).toBe(0);
  });
});

describe('cameraMoveToMotion', () => {
  it('static yields no motion and no img2img recursion', () => {
    expect(cameraMoveToMotion('static')).toEqual({ imgToImgStrength: 0 });
  });

  it('a pan implies BOTH a directional shift and non-zero img2img strength', () => {
    const m = cameraMoveToMotion('pan-left');
    expect(m.cameraMotion).toEqual({ dx: -1, dy: 0 });
    expect(m.imgToImgStrength).toBeGreaterThan(0);
  });
});

describe('normaliseShotBudget', () => {
  it('treats LLM counts as proportions and rescales to the target total', () => {
    const shots: PlannedShot[] = [
      { id: 'a', prompt: 'x', characterIds: [], camera: 'static', action: '', durationFrames: 1 },
      { id: 'b', prompt: 'y', characterIds: [], camera: 'static', action: '', durationFrames: 1 },
    ];
    const out = normaliseShotBudget(shots, 10);
    expect(out.reduce((a, s) => a + s.durationFrames, 0)).toBe(10);
    expect(out.every((s) => s.durationFrames >= 1)).toBe(true);
  });
});
