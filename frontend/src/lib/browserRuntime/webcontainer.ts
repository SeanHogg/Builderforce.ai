/**
 * runBuildInWebContainer — run a build/test command for the agent's working tree
 * inside a WebContainer (Node in the browser). The repo snapshot is mounted and
 * the command is spawned; a non-zero exit means the change must NOT be pushed.
 *
 * The WebContainer is abstracted behind {@link WebContainerLike} (and `boot` is
 * injected) so the orchestration is unit-testable with a fake; the real boot via
 * `@webcontainer/api` is wired in factory.ts behind a capability check (a
 * WebContainer needs cross-origin isolation, so it only runs in a real tab).
 */

export interface SpawnedProcess {
  output: ReadableStream<string>;
  exit: Promise<number>;
}

export interface WebContainerLike {
  mount(tree: unknown): Promise<void>;
  spawn(command: string, args: string[]): Promise<SpawnedProcess>;
}

export interface BuildDeps {
  boot: () => Promise<WebContainerLike>;
  /** A FileSystemTree snapshot of the working tree to mount. */
  tree: unknown;
}

/** Collect a ReadableStream<string> into one string. */
async function drain(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (typeof value === 'string') out += value;
  }
  return out;
}

export async function runBuildInWebContainer(
  deps: BuildDeps,
  command: readonly string[],
): Promise<{ ok: boolean; output: string }> {
  if (command.length === 0) throw new Error('runBuildInWebContainer: empty command');
  const [bin, ...args] = command;
  const wc = await deps.boot();
  await wc.mount(deps.tree);
  const proc = await wc.spawn(bin as string, args);
  const output = await drain(proc.output);
  const code = await proc.exit;
  return { ok: code === 0, output };
}
