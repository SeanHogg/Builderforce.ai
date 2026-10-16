/**
 * The browser coding dispatch's build gate: before an agent's change is pushed,
 * it is type-checked and built in this tab by BuilderForce WebContainers — the
 * same Check the workspace runs (`runProjectChecks`), on the same runtime, with no
 * install and no server.
 *
 * Two rules keep it from blocking work it has no business judging:
 *  - a project the runtime cannot build (Next.js, a Node server) or a repo too
 *    large for a tab is SKIPPED, not failed — it pushes as it did before the gate;
 *  - type errors count only in the files the agent wrote, so a repo that already
 *    had type errors elsewhere does not block every change made to it.
 *
 * Ports in, so the decisions are tested without a browser.
 */
import type { TypecheckOutcome } from './siteTools';
import type { CheckPorts } from './projectChecks';
import { runProjectChecks } from './projectChecks';
import type { WorkingTree } from './workingTree';

export interface BuildGateResult {
  ok: boolean;
  output: string;
  /** The gate did not judge this change (see above); `ok` is true. */
  skipped?: boolean;
}

export interface BuildGatePorts {
  readTree: () => Promise<WorkingTree>;
  hasTypeScript: (files: Record<string, string | Uint8Array>) => boolean;
  typecheck: (files: Record<string, string | Uint8Array>) => Promise<TypecheckOutcome>;
  buildPort: (files: Record<string, string | Uint8Array>) => Promise<CheckPorts['build']>;
}

/** `./src/a.ts`, `/src/a.ts` and `src/a.ts` are one file. */
const normalize = (path: string) => path.replace(/^\.?\/+/, '');

export async function runBuildGate(changedPaths: readonly string[], ports: BuildGatePorts): Promise<BuildGateResult> {
  const tree = await ports.readTree();
  if (tree.kind === 'too-large') return { ok: true, skipped: true, output: `Build gate skipped: ${tree.reason}.` };
  const { files } = tree;

  const build = await ports.buildPort(files);
  if (typeof build !== 'function') return { ok: true, skipped: true, output: `Build gate skipped: ${build.skip}` };

  const changed = new Set(changedPaths.map(normalize));
  // A diagnostic with no file is global (compiler options, a missing lib): the agent's
  // only when it edited a tsconfig.
  const ownsGlobal = [...changed].some((path) => /(^|\/)tsconfig[^/]*\.json$/.test(path));
  const isAgents = (file: string | undefined) => (file ? changed.has(normalize(file)) : ownsGlobal);
  const output: string[] = [];
  const { failures } = await runProjectChecks({
    typecheck: ports.hasTypeScript(files)
      ? async () => {
        const outcome = await ports.typecheck(files);
        return { ...outcome, errors: outcome.errors.filter((d) => isAgents(d.file)) };
      }
      : null,
    build,
    lint: null,
    onStep: (label) => output.push(`── ${label}`),
    onOutput: (text) => output.push(text.replace(/\r\n/g, '\n').trimEnd()),
  });

  if (!failures.length) return { ok: true, output: output.join('\n') };
  return { ok: false, output: failures.map((f) => [f.message, f.detail].filter(Boolean).join('\n')).join('\n\n') };
}
