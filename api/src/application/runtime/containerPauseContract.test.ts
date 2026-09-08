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
import { OP_HANDLERS } from './cloudAgent/containerOps';

// `fileURLToPath(import.meta.url)` (a STRING argument) rather than the usual
// `new URL('.', import.meta.url)`: this repo's DOM + node lib mix makes the global
// `URL` structurally incompatible with node's, so passing one fails the type-check.
const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '../../..');
const read = (rel: string) => readFileSync(resolve(apiRoot, rel), 'utf8');

const containerImage = read('container/server.mjs');
// The pause itself now lives ONCE, in the dispatch table both images run — the
// container by importing it, the Actions runner by inlining the generated copy of it.
const relayModule = read('container/agentRelay.mjs');
const actionsRunner = read('src/application/runtime/githubActionsRunner.ts');
const engine = read('src/application/runtime/cloudAgentEngine.ts');
// The container op protocol is a DISPATCH TABLE now, not an `if (op === …)` chain
// inside the engine — so the op's implementation is asserted where it actually lives.
const containerOps = read('src/application/runtime/cloudAgent/containerOps.ts');

describe('container/agentRelay.mjs — the pause, implemented once for both images', () => {
  it('handles the ask_human tool by posting the ask_human op', () => {
    expect(relayModule).toContain("name === 'ask_human'");
    expect(relayModule).toContain("op('ask_human'");
  });

  it('hands the conversation over, so the resumed process continues rather than restarts', () => {
    // `messages` is the whole point: the repo survives on the ticket branch, the
    // conversation survives ONLY because it is posted here.
    expect(relayModule).toMatch(/messages: Array\.isArray\(state\.messages\)/);
    expect(relayModule).toMatch(/writtenPaths: state\.writtenPaths/);
  });

  it('returns `paused` so the calling image stops its loop', () => {
    expect(relayModule).toMatch(/if \(r && r\.paused\) return \{ ok: true, paused: true/);
  });
});

describe('ask_human is wired end to end on the redispatch surfaces', () => {
  it('the surface advertises it, so the model can actually reach it', () => {
    expect(CONTAINER_SURFACE_CAPS.has('human')).toBe(true);
    expect(CONTAINER_AGENT_TOOLS.map((t) => t.function.name)).toContain('ask_human');
  });

  it('the Worker implements the op the images call', () => {
    // A real entry in the op table — a stronger assertion than the old string match
    // on an `if (op === …)` branch: a handler that exists but is not REGISTERED is
    // precisely the failure the table exists to make impossible, and `OP_HANDLERS`
    // is the only thing `handleContainerOp` will dispatch through.
    expect(OP_HANDLERS.ask_human).toBeTypeOf('function');
    // It must PARK the row: an op that only opened a question would leave the run
    // looking live while its process has already exited, and the orphan reaper would
    // kill it within the surface's silence ceiling.
    expect(containerOps).toMatch(/set\(\{ status: 'paused'/);
    // And it must go through the shared primitive, not a private copy — that is what
    // gives the container the same approval + needs-attention routing + resume record
    // the durable surface gets.
    expect(containerOps).toContain('pauseExecutionForQuestion');
  });

  for (const [label, source] of [
    ['container/server.mjs', containerImage],
    ['githubActionsRunner.ts', actionsRunner],
  ] as const) {
    describe(label, () => {
      it('routes the tool through the shared relay table, carrying its live loop state', () => {
        // The image no longer implements the pause itself — it hands the call to the
        // ONE dispatch table both images run. What each image still owns is passing
        // the state only it has: the conversation to hand over, and the live
        // `writtenPaths` set the resumed process must be seeded with.
        expect(source).toContain('execRelayTool');
        expect(source).toMatch(/messages: loop && Array\.isArray\(loop\.messages\)/);
        expect(source).toMatch(/writtenPaths,/);
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
