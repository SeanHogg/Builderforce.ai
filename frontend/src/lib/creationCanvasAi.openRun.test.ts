/**
 * regression: the canvas reaches the agent through `openRun` (one entry), with its entry point named explicitly.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(resolve(__dirname, name), 'utf8');

describe('canvas entry', () => {
  it('imports and calls openRun, never runAgent', () => {
    const text = read('creationCanvasAi.ts');
    expect(text).toMatch(/\{ openRun \} = await import\('@builderforce\/agent-run'\)/);
    expect(text).toMatch(/\bopenRun\(/);
    expect(text).not.toMatch(/\brunAgent\(/);
  });

  it("names entryPoint 'canvas' in the policy it hands over", () => {
    expect(read('canvasRunPorts.ts')).toContain("entryPoint: 'canvas'");
  });
});
