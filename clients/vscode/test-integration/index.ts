/**
 * The Mocha entry `@vscode/test-electron` loads INSIDE the extension host.
 *
 * The suites are imported statically rather than globbed off disk, because this file
 * is bundled by esbuild (same as the extension and the harness) — one bundle, no
 * runtime file discovery, and a missing suite is a build error instead of a silently
 * empty run.
 */

import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20_000 });
  // `suite`/`test` are globals installed by the TDD interface, which only exists once
  // the runner is constructed — hence the deferred require rather than a top import.
  mocha.suite.emit('pre-require', globalThis, 'extension.test', mocha);
  require('./extension.test');
  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) reject(new Error(`${failures} extension-host test(s) failed`));
        else resolve();
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
