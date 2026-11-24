import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toAgentDeclaration, type AgentDraft } from '@builderforce/creation-canvas-contract';

// The two calls to the built-in tool relay; what they answer is the server's business.
vi.mock('@/lib/builtinTools', () => ({
  callBuiltinTool: vi.fn(),
  listBuiltinToolKeys: vi.fn(async () => []),
}));

import { ApiRequestError } from '@/lib/apiClient';
import { callBuiltinTool, listBuiltinToolKeys } from '@/lib/builtinTools';
import {
  agentDraftGaps,
  agentDraftPreview,
  agentDraftSendable,
  declareAppAgent,
  loadAgentToolOptions,
  projectHasAppManifest,
} from './appAgentDeclaration';
import { ENV_TOOL_KEYS, manifestAgentDeclarationRows } from './manifestAgents';

const NO_ROLE = 'none';
const CATALOG = ['env.fs.read', 'github.issues.list'];

const draft = (patch: Partial<AgentDraft> = {}): AgentDraft => ({
  id: 'triage',
  role: { kind: 'role', key: 'developer' },
  instructionsPath: '',
  tools: [],
  triggers: [],
  budget: {},
  ...patch,
});

describe('agentDraftGaps — what the form says before sending', () => {
  it('finds nothing in a draft with an id and a role', () => {
    const gaps = agentDraftGaps(draft({ tools: ['env.fs.read'] }), CATALOG);
    expect(gaps).toEqual({ missingId: false, missingRole: false, unknownTools: [] });
    expect(agentDraftSendable(gaps)).toBe(true);
  });

  it('flags an empty role and holds the draft back', () => {
    const gaps = agentDraftGaps(draft({ role: { kind: 'role', key: '   ' } }), CATALOG);
    expect(gaps.missingRole).toBe(true);
    expect(agentDraftSendable(gaps)).toBe(false);
  });

  it('flags a blank id', () => {
    expect(agentDraftSendable(agentDraftGaps(draft({ id: '  ' }), CATALOG))).toBe(false);
  });

  /** A hint, not a verdict: the tool is pointed at, the draft may still be sent. */
  it('points at a granted tool outside the catalog without holding the draft back', () => {
    const gaps = agentDraftGaps(draft({ tools: ['env.fs.read', 'env.secret.read'] }), CATALOG);
    expect(gaps.unknownTools).toEqual(['env.secret.read']);
    expect(agentDraftSendable(gaps)).toBe(true);
  });

  it('points at no tool while the catalog loads', () => {
    expect(agentDraftGaps(draft({ tools: ['env.secret.read'] }), null).unknownTools).toEqual([]);
  });
});

describe('agentDraftPreview', () => {
  /** The question the form asks for a missing role stands beside a preview that says so. */
  it('reads a draft with no role as the room would: no role declared', () => {
    const rows = manifestAgentDeclarationRows(agentDraftPreview(draft({ role: { kind: 'role', key: '' } })), NO_ROLE);
    expect(rows).toEqual([['role', NO_ROLE]]);
  });

  it('lists the role or workload and the instructions as declared', () => {
    const rows = manifestAgentDeclarationRows(
      agentDraftPreview(draft({ role: { kind: 'workload', key: 'summarize' }, instructionsPath: ' agents/triage.md ' })),
      NO_ROLE,
    );
    expect(rows).toEqual([['role', NO_ROLE], ['workload', 'summarize'], ['instructions', 'agents/triage.md']]);
  });
});

describe('loadAgentToolOptions', () => {
  it('offers the environment tools and the caller\'s catalog, once each, as manifest tool keys', async () => {
    vi.mocked(listBuiltinToolKeys).mockResolvedValueOnce(['github.issues.list', 'env.fs.read', 'Not A Key', 'files']);
    const options = await loadAgentToolOptions();
    expect(options).toEqual([...ENV_TOOL_KEYS, 'github.issues.list']);
  });
});

describe('projectHasAppManifest', () => {
  beforeEach(() => vi.mocked(callBuiltinTool).mockReset());

  it('reads the next path when one is absent', async () => {
    vi.mocked(callBuiltinTool)
      .mockRejectedValueOnce(new ApiRequestError('Not found', 404))
      .mockResolvedValueOnce({ text: '{}' });
    await expect(projectHasAppManifest(7)).resolves.toBe(true);
  });

  it('rethrows a failure that is not an absence', async () => {
    vi.mocked(callBuiltinTool).mockRejectedValueOnce(new ApiRequestError('Forbidden', 403));
    await expect(projectHasAppManifest(7)).rejects.toThrow('Forbidden');
  });
});

describe('declareAppAgent', () => {
  beforeEach(() => vi.mocked(callBuiltinTool).mockReset());

  it('sends the declaration the draft maps to and reports the declared id', async () => {
    vi.mocked(callBuiltinTool).mockResolvedValueOnce({ ok: true, agentId: 'triage' });
    await expect(declareAppAgent(7, draft())).resolves.toEqual({ ok: true, agentId: 'triage' });
    expect(callBuiltinTool).toHaveBeenCalledWith('app_manifest.add_agent', { projectId: 7, id: 'triage', agent: toAgentDeclaration(draft()) });
  });

  /** The server reads the manifest, so a duplicate id is its sentence, with no typed issue. */
  it('returns a duplicate id as the server\'s refusal', async () => {
    vi.mocked(callBuiltinTool).mockResolvedValueOnce({ ok: false, error: 'An agent "triage" is already declared; nothing was written.', agentId: 'triage' });
    await expect(declareAppAgent(7, draft())).resolves.toEqual({
      ok: false,
      refusal: { error: 'An agent "triage" is already declared; nothing was written.', issues: [] },
    });
  });

  /** The validator's typed issues pass through as they came: code, path and sentence. */
  it("carries the validator's typed issues — an empty role and a tool outside the catalog", async () => {
    vi.mocked(callBuiltinTool).mockResolvedValueOnce({
      ok: false,
      error: 'The declaration was refused; nothing was written.',
      errors: [
        { code: 'invalid-value', severity: 'error', path: 'agents.triage.role', value: '', message: '"agents.triage.role" has an invalid value "".' },
        { code: 'invalid-value', severity: 'error', path: 'agents.triage.tools', value: 'env.secret.read', message: '"agents.triage.tools" has an invalid value "env.secret.read".' },
      ],
    });
    const result = await declareAppAgent(7, draft({ role: { kind: 'role', key: '' }, tools: ['env.secret.read'] }));
    expect(result).toEqual({
      ok: false,
      refusal: {
        error: 'The declaration was refused; nothing was written.',
        issues: [
          { code: 'invalid-value', path: 'agents.triage.role', message: '"agents.triage.role" has an invalid value "".' },
          { code: 'invalid-value', path: 'agents.triage.tools', message: '"agents.triage.tools" has an invalid value "env.secret.read".' },
        ],
      },
    });
  });

  it('throws when the relay itself fails', async () => {
    vi.mocked(callBuiltinTool).mockRejectedValueOnce(new ApiRequestError('Bad gateway', 502));
    await expect(declareAppAgent(7, draft())).rejects.toThrow('Bad gateway');
  });
});
