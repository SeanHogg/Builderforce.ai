/**
 * The container / GitHub-Actions pause is a THREE-PARTY contract, and only one of
 * the three parties is ordinary TypeScript:
 *
 *   • the Worker's `ask_human` container-op (cloudAgentEngine),
 *   • `container/server.mjs` — a separately built image, plain ESM, no imports here,
 *   • `githubActionsRunner.ts` — a JS program rendered into a template string and
 *     executed on someone else's runner.
 *
 * Neither image can be imported or type-checked from this process, so nothing but a
 * test like this can stop them drifting from the op they call. The specific drift
 * that would be catastrophic is the terminal op: if a paused image still posts
 * `finalize` it opens a pull request on half-finished work, and if it posts `fail`
 * a perfectly answerable run is marked failed and burns a strike against the
 * autonomy circuit breaker. So the assertions below are about the SHAPE of the exit,
 * not about incidental text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTAINER_AGENT_TOOLS, CONTAINER_SURFACE_CAPS } from './cloudAgentTools';

// `fileURLToPath(import.meta.url)` (a STRING argument) rather than the usual
// `new URL('.', import.meta.url)`: this repo's DOM + node lib mix makes the global
// `URL` structurally incompatible with node's, so passing one fails the type-check.
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '../../..');
const read = (rel: string) => readFileSync(resolve(apiRoot, rel), 'utf8');

const containerImage = read('container/server.mjs');
const actionsRunner = read('src/application/runtime/githubActionsRunner.ts');
const engine = read('src/application/runtime/cloudAgentEngine.ts');

describe('ask_human is wired end to end on the redispatch surfaces', () => {
  it('the surface advertises it, so the model can actually reach it', () => {
    expect(CONTAINER_SURFACE_CAPS.has('human')).toBe(true);
    expect(CONTAINER_AGENT_TOOLS.map((t) => t.function.name)).toContain('ask_human');
  });

  it('the Worker implements the op the images call', () => {
    expect(engine).toContain("if (op === 'ask_human')");
    // It must PARK the row: an op that only opened a question would leave the run
    // looking live while its process has already exited, and the orphan reaper would
    // kill it within the surface's silence ceiling.
    expect(engine).toMatch(/set\(\{ status: 'paused'/);
    // And it must go through the shared primitive, not a private copy — that is what
    // gives the container the same approval + needs-attention routing + resume record
    // the durable surface gets.
    expect(engine).toContain('pauseExecutionForQuestion');
  });

  for (const [label, source] of [
    ['container/server.mjs', containerImage],
    ['githubActionsRunner.ts', actionsRunner],
  ] as const) {
    describe(label, () => {
      it('handles the ask_human tool by posting the ask_human op', () => {
        expect(source).toContain("name === 'ask_human'");
        expect(source).toContain("'ask_human'");
      });

      it('hands its conversation over, so the resumed process continues rather than restarts', () => {
        // `messages` is the whole point: the repo survives on the ticket branch, the
        // conversation survives ONLY because it is posted here.
        expect(source).toMatch(/messages: loop && Array\.isArray\(loop\.messages\)/);
        expect(source).toMatch(/writtenPaths: \[\.\.\.writtenPaths\]/);
      });

      it('stops the loop on a paused tool result instead of running more tools', () => {
        expect(source).toMatch(/result\.paused/);
        expect(source).toMatch(/paused = true/);
      });

      it('exits WITHOUT a terminal op when paused — no finalize (no PR), no fail (not a failure)', () => {
        // The terminal branch must test `paused` BEFORE it reaches either terminal op.
        const terminalIdx = Math.min(
          source.indexOf("op('fail'") >= 0 ? source.indexOf("op('fail'") : source.indexOf("op: 'fail'"),
          source.indexOf("op('finalize'") >= 0 ? source.indexOf("op('finalize'") : source.indexOf("op: 'finalize'"),
        );
        const pausedGuard = source.lastIndexOf('if (paused)');
        expect(pausedGuard).toBeGreaterThan(0);
        expect(pausedGuard).toBeLessThan(terminalIdx);
      });

      it('seeds a resumed run from spec.resume rather than from the task prompt', () => {
        expect(source).toMatch(/spec\.resume && Array\.isArray\(spec\.resume\.messages\)/);
        expect(source).toContain('resume.writtenPaths');
      });
    });
  }
});
