import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  streamChatCompletion: vi.fn(),
  ensureGuestToken: vi.fn(async () => true),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seanhogg/builderforce-brain-embedded')>()),
  fetchMcpToolEntries: vi.fn(async () => []),
  mcpActionsFrom: vi.fn(() => []),
  streamChatCompletion: mocks.streamChatCompletion,
}));
vi.mock('@/lib/brain/runtime', () => ({ brainConfig: { transport: {} } }));
vi.mock('@/lib/brain/guestRuntime', () => ({ guestBrainConfig: { transport: {} } }));
vi.mock('@/lib/guestRoomApi', () => ({ ensureGuestToken: mocks.ensureGuestToken }));

const { runCreationCanvasAi, MAX_CANVAS_TOOL_TURNS } = await import('./creationCanvasAi');

describe('runCreationCanvasAi', () => {
  beforeEach(() => {
    mocks.streamChatCompletion.mockReset();
    mocks.ensureGuestToken.mockResolvedValue(true);
  });

  it('executes a guest canvas tool call and distinguishes LLM from Evermind', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-1', name: 'canvas_add_object', args: JSON.stringify({ kind: 'llm', title: 'New LLM' }) }],
      })
      .mockResolvedValueOnce({ text: 'I proposed a new LLM for review.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'build a new LLM',
      guestTurnId: 'user-submit-1',
      canvasSnapshot: '{"objects":[]}',
      persistence: 'local',
      canvasActions: [{
        name: 'canvas_add_object',
        description: 'Add an object',
        parameters: { type: 'object' },
        mutates: true,
        run,
      }],
    });

    expect(run).toHaveBeenCalledWith({ kind: 'llm', title: 'New LLM' });
    expect(answer).toBe('I proposed a new LLM for review.');
    const firstRequest = mocks.streamChatCompletion.mock.calls[0][0];
    const secondRequest = mocks.streamChatCompletion.mock.calls[1][0];
    expect(firstRequest.metadata.guestTurnId).toBe('user-submit-1');
    expect(secondRequest.metadata.guestTurnId).toBe('user-submit-1');
    expect(firstRequest.metadata.guestTurnInput).toBe('build a new LLM');
    expect(secondRequest.metadata.guestTurnInput).toBe('build a new LLM');
    // The canvas action PLUS the three research tools a logged-out board gets in place
    // of the tenant MCP catalog. Without them the system prompt names tools the guest
    // model was never given, and "research X and chart it" answers from memory.
    expect(firstRequest.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      'canvas_add_object', 'builtin_web_search', 'builtin_web_fetch', 'builtin_geo_geocode',
    ]);
    expect(firstRequest.messages[1].content).toContain('kind "llm" is a conventional language-model blueprint');
    expect(firstRequest.messages[1].content).toContain('kind "evermind" is BuilderForce\'s self-learning Evermind model');
    expect(firstRequest.messages[1].content).toContain('"create a workflow" means call canvas_add_object');
    expect(firstRequest.messages[1].content).toContain('do not call builtin_workflows_create or ask a follow-up question');
    expect(firstRequest.messages[1].content).toContain('call canvas_arrange_objects');
    expect(firstRequest.messages[1].content).toContain('first call canvas_read_project_prds');
    expect(firstRequest.messages[1].content).toContain('Then call canvas_create_project_prd');
    expect(firstRequest.messages[1].content).toContain('regardless of the current canvas selection');
    expect(firstRequest.messages[1].content).toContain('Never emit tool_code');
    expect(firstRequest.messages[1].content).toContain('Never create a blank drawing or visual placeholder');
    expect(firstRequest.messages[1].content).toContain('A correction, complaint, question about a displayed value');
    expect(firstRequest.messages[1].content).toContain('Never create a replacement or duplicate');
    expect(firstRequest.messages[1].content).toContain('Never claim an object was updated unless canvas_update_object succeeded');
  });

  it('runs an invited Canvas agent under its own identity and instructions', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'I recommend validating demand before expanding scope.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'Contribute to the launch discussion', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      participant: { ref: 'market-researcher', name: 'Market Researcher', instructions: 'Challenge unsupported market assumptions.' },
      conversation: [{ role: 'user', content: 'Should we launch this product?' }],
    });

    expect(answer).toContain('validating demand');
    const system = mocks.streamChatCompletion.mock.calls[0][0].messages[1].content;
    expect(system).toContain('You are Market Researcher, an invited specialist agent');
    expect(system).toContain('Challenge unsupported market assumptions.');
    expect(system).toContain('Do not pretend to be Brain');
  });

  it('does not claim that a large document stub satisfies the requested page count', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-document', name: 'canvas_add_object', args: JSON.stringify({
          kind: 'document', title: 'Comprehensive Astronomy',
          fields: { content: 'A short astronomy overview that describes the intended scope.' },
        }) }],
      })
      .mockResolvedValueOnce({ text: 'I created the complete 400-page Word document.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'create a 400 page word doc on astronomy', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(run).toHaveBeenCalledOnce();
    expect(answer).toContain('not the requested 400 pages');
    expect(answer).toContain('I have not marked it complete');
    expect(answer).not.toContain('complete 400-page');
  });

  it('preserves the model answer when the document meets a small requested length', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{ id: 'call-document', name: 'canvas_add_object', args: JSON.stringify({
          kind: 'document', fields: { markdown: Array.from({ length: 310 }, (_, index) => `word${index}`).join(' ') },
        }) }],
      })
      .mockResolvedValueOnce({ text: 'I created the requested one-page document.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'write a 1 page document', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(answer).toBe('I created the requested one-page document.');
  });

  it('corrects a false completion claim on a follow-up status question', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Yes, I am creating it now. I added the 400-page document.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'are you creating the document?',
      canvasSnapshot: JSON.stringify({ objects: [{ kind: 'document', title: 'Astronomy', content: 'Only a short scope description.' }] }),
      persistence: 'local', canvasActions: [],
      conversation: [
        { role: 'user', content: 'create a 400 page word doc on astronomy' },
        { role: 'assistant', content: 'I will create it.' },
      ],
    });

    expect(answer).toContain('does not verify the requested 400 pages');
    expect(answer).toContain('it is not complete');
    expect(answer).not.toContain('400-page document');
  });

  it('does not claim changes were applied when the bounded tool loop is exhausted', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion.mockResolvedValue({
      text: '',
      toolCalls: [{ id: 'call-1', name: 'canvas_add_object', args: JSON.stringify({ kind: 'note' }) }],
    });

    const answer = await runCreationCanvasAi({
      prompt: 'add notes', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(run).toHaveBeenCalledTimes(MAX_CANVAS_TOOL_TURNS);
    expect(answer).toBe('I added the requested content to the canvas.');
  });

  it('reports a rejected layout operation instead of claiming that changes exist', async () => {
    const run = vi.fn(() => ({ error: 'At least two unlocked objects are required to arrange the canvas' }));
    mocks.streamChatCompletion.mockResolvedValue({
      text: '',
      toolCalls: [{ id: 'call-layout', name: 'canvas_arrange_objects', args: '{}' }],
    });

    const answer = await runCreationCanvasAi({
      prompt: 'fix the layout', canvasSnapshot: '{"scope":"selection","objects":[{"id":"brain"}]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_arrange_objects', description: 'Arrange', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(answer).toBe("I couldn't prepare the requested canvas changes: At least two unlocked objects are required to arrange the canvas");
  });

  it('uses canonical Brain auto-approve for mutating tenant actions', async () => {
    const run = vi.fn(() => ({ ok: true }));
    const confirmAction = vi.fn(async () => false);
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'call-tenant', name: 'tenant_update', args: '{"enabled":true}' }] })
      .mockResolvedValueOnce({ text: 'Updated.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'update it', canvasSnapshot: '{"objects":[]}', persistence: 'local', autoApprove: true,
      confirmAction,
      canvasActions: [{ name: 'tenant_update', description: 'Update tenant state', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(run).toHaveBeenCalledWith({ enabled: true });
    expect(confirmAction).not.toHaveBeenCalled();
    expect(answer).toBe('Updated.');
  });

  it('uses the in-app approval callback and never a browser prompt', async () => {
    const run = vi.fn(() => ({ ok: true }));
    const confirmAction = vi.fn(async () => true);
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'call-approved', name: 'tenant_update', args: '{"enabled":true}' }] })
      .mockResolvedValueOnce({ text: 'Approved and updated.', toolCalls: [] });

    await runCreationCanvasAi({
      prompt: 'update it', canvasSnapshot: '{"objects":[]}', persistence: 'local', confirmAction,
      canvasActions: [{ name: 'tenant_update', description: 'Update tenant state', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(confirmAction).toHaveBeenCalledWith({ name: 'tenant_update', args: { enabled: true } });
    expect(run).toHaveBeenCalledOnce();
  });

  it('grounds a project canvas turn with Evermind and reports recall and learning steps', async () => {
    const answer = 'Use the established launch checklist and preserve the approved review gate for every release.';
    const learn = vi.fn(async () => ({ ok: true, queued: 1 }));
    const onTrace = vi.fn();
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: answer, toolCalls: [] });

    await runCreationCanvasAi({
      prompt: 'How should we release?', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      evermind: {
        recall: async () => ({ seeded: true, version: 4, mode: 'connected', items: [{ id: 8, text: 'Use the established launch checklist and preserve the approved review gate', score: .92 }] }),
        learn,
      },
      onTrace,
    });

    expect(mocks.streamChatCompletion.mock.calls[0][0].messages[1].content).toContain('[Evermind Memory');
    expect(learn).toHaveBeenCalledWith(answer, 'How should we release?');
    expect(onTrace.mock.calls.map(([event]) => event.category)).toEqual(['recall', 'learn', 'reconcile']);
  });
  const DATASET_SNAPSHOT = JSON.stringify({
    objects: [{ id: 'ds-1', kind: 'dataset', title: '07_30_2026.csv', rowCount: 812, columns: ['Shipment ID', 'Count Delivery'] }],
  });

  it('directs data questions to the query tool instead of authored values', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Done.', toolCalls: [] });

    await runCreationCanvasAi({
      prompt: 'chart the delivery success rate', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local', canvasActions: [],
    });

    const system = mocks.streamChatCompletion.mock.calls[0][0].messages[1].content;
    expect(system).toContain('must come from canvas_query_dataset');
    expect(system).toContain('placeholder or example figures');
    expect(system).toContain('materializeAs');
  });

  it('refuses to report a canvas artifact that no tool actually created', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({
      text: 'I have created a table to visualize the shipment data, highlighting successes and failures.',
      toolCalls: [],
    });

    const answer = await runCreationCanvasAi({
      prompt: 'Use this data set to visualize as a table', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local', canvasActions: [],
    });

    expect(answer).toContain('did not actually make one');
    expect(answer).not.toContain('I have created a table');
  });

  it('keeps a creation claim when a canvas mutation really was proposed', async () => {
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'c1', name: 'canvas_query_dataset', args: JSON.stringify({ materializeAs: 'table' }) }] })
      .mockResolvedValueOnce({ text: 'I have created a table from all 812 rows.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'build the table', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local',
      canvasActions: [{
        name: 'canvas_query_dataset', description: 'Query', parameters: { type: 'object' }, mutates: true,
        run: () => ({ ok: true, proposed: true, groups: [{ key: 'Success', count: 700 }] }),
      }],
    });

    expect(answer).toBe('I have created a table from all 812 rows.');
  });

  it('flags fabricated figures when the canvas holds real rows', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({
      text: "I've used placeholder values (75 successful, 25 unsuccessful) for demonstration purposes.",
      toolCalls: [{ id: 'c1', name: 'canvas_add_object', args: '{}' }],
    });
    mocks.streamChatCompletion.mockResolvedValueOnce({
      text: "I've used placeholder values (75 successful, 25 unsuccessful) for demonstration purposes.",
      toolCalls: [],
    });

    const answer = await runCreationCanvasAi({
      prompt: 'visualize it', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: () => ({ ok: true, proposed: true }) }],
    });

    expect(answer).toContain('Those figures are not real');
  });
});
