/**
 * Guard: the review worker is named by URL in `workerFactory.ts` and nowhere else.
 *
 * `new Worker(new URL(…, import.meta.url))` makes webpack emit a browser chunk loader
 * (`document.baseURI`) statically. The frontend's server/edge build aliases this one
 * module to `workerFactory.stub.ts`; if the expression creeps back into
 * `reviewWorkerClient.ts` (or any other module here), the loader lands in the shared edge
 * runtime again and `next build` fails with `ReferenceError: document is not defined`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');
/** Comments may name the pattern; only code counts. */
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const WORKER_BY_URL = /new\s+Worker\s*\(|import\.meta\.url/;

describe('review worker construction is isolated in workerFactory.ts', () => {
  it('reviewWorkerClient.ts never constructs the worker by URL', () => {
    expect(code(read('reviewWorkerClient.ts'))).not.toMatch(WORKER_BY_URL);
  });

  it('workerFactory.ts is the only source module that does', () => {
    const offenders = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => WORKER_BY_URL.test(code(read(f))));
    expect(offenders).toEqual(['workerFactory.ts']);
  });

  it('the server stub keeps the same export and names no URL', () => {
    const stub = code(read('workerFactory.stub.ts'));
    expect(stub).toMatch(/export function createReviewWorker\(\): Worker/);
    expect(stub).not.toMatch(WORKER_BY_URL);
  });
});
