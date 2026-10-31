/** A sandboxed cloud run holds `shell.jobs`, so `command_status` / `command_stop` are advertised and run. */
import { describe, expect, it } from 'vitest';
import type { Capability } from '@builderforce/agent-tools';
import { cloudAgentToolsFor } from '../cloudAgentTools';
import { durableRunCaps } from './runSurfaceCaps';
import type { TicketRepoContext } from '../../repos/commitFileAsPendingChange';

const OFF = { COST_LEVERS_ALL: 'off' };
const repo: TicketRepoContext = {
  provider: 'github', host: null, owner: 'o', repo: 'r', token: 't', branch: 'bf/1', base: 'main', repoId: 'rid', segmentId: null, projectId: 4,
};
const owner = { parent: {}, runtime: {} } as never;
const names = (caps: ReadonlySet<Capability>) => cloudAgentToolsFor(caps).map((t) => t.function.name);

describe('durableRunCaps and background jobs', () => {
  it('holds `shell.jobs` only when the run has a sandbox', () => {
    expect(durableRunCaps(OFF, 1, owner, repo, true).has('shell.jobs')).toBe(true);
    expect(durableRunCaps(OFF, 1, owner, repo).has('shell.jobs')).toBe(false);
  });

  it('advertises command_status and command_stop to a sandboxed run, and to no other', () => {
    const sandboxed = names(durableRunCaps(OFF, 1, owner, repo, true));
    expect(sandboxed).toEqual(expect.arrayContaining(['run_command', 'command_status', 'command_stop']));
    const plain = names(durableRunCaps(OFF, 1, owner, repo));
    expect(plain).not.toContain('command_status');
    expect(plain).not.toContain('command_stop');
  });
});
