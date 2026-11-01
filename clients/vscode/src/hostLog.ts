/**
 * Write one line to the BuilderForce output channel from a module that must not load
 * `vscode` with it.
 *
 * `errorReporter` pulls `vscode` (and an EventEmitter) into the module graph, so it is
 * imported lazily: a suite that mocks `vscode` away, and a host module that only logs on a
 * rare path, never pay for it. A reporter that cannot load falls back to `console.warn`.
 */
export function hostLog(line: string): void {
  void import("./errorReporter")
    .then(({ logLine }) => logLine(line))
    .catch((error: unknown) => console.warn(line, error));
}
