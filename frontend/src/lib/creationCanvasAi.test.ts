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
    expect(firstRequest.messages[1].content).toContain('add an Agent with that role\'s perspective');
    expect(firstRequest.messages[1].content).toContain('connect it to the Agent with canvas_connect_objects');
    expect(firstRequest.messages[1].content).toContain('never ask the user what "this" means');
    expect(firstRequest.messages[1].content).toContain('fields.pages containing real page objects');
    expect(firstRequest.messages[1].content).toContain('Never rely on default ecommerce copy');
  });

  it('recovers a prose-only selected Website refinement and executes the update', async () => {
    const update = vi.fn(() => ({ ok: true, proposed: true, objectId: 'site-1' }));
    const pages = [{ id: 'home', name: 'Home', path: '/', sections: [
      { id: 'hero', kind: 'hero', heading: 'Turn operational data into confident decisions', body: 'Acme Analytics gives operators clarity.', cta: 'Book a demo' },
      { id: 'features', kind: 'features', heading: 'Decide sooner', items: [{ title: 'Live signals', body: 'See risk early.' }] },
    ] }];
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: 'I will update the website with that content.', toolCalls: [] })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'update-site', name: 'canvas_update_object', args: JSON.stringify({ objectId: 'site-1', fields: { pages, websiteTheme: { style: 'technical', accent: '#28c9b7' } } }) }] })
      .mockResolvedValueOnce({ text: 'I updated the selected website with the Acme content and navigation.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'Use Home, About, Services, and Contact and change the headline for Acme Analytics.',
      canvasSnapshot: JSON.stringify({ scope: 'selection', selectedObjectIds: ['site-1'], objects: [{ id: 'site-1', kind: 'website', title: 'Acme', mutableFields: ['pages', 'websiteTheme'] }] }),
      persistence: 'local',
      canvasActions: [{ name: 'canvas_update_object', description: 'Update', parameters: { type: 'object' }, mutates: true, run: update }],
    });

    expect(update).toHaveBeenCalledWith({ objectId: 'site-1', fields: { pages, websiteTheme: { style: 'technical', accent: '#28c9b7' } } });
    expect(answer).toContain('updated the selected website');
    expect(mocks.streamChatCompletion.mock.calls[1][0].messages.some((message: { content: string }) => message.content.includes('prior response described or discussed'))).toBe(true);
  });

  it('captures resolved model provenance and disables a model that twice refuses a Canvas command', async () => {
    const completions: unknown[] = [];
    const disabled = vi.fn();
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: 'I will create it.', toolCalls: [], resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'Tell me what to create.', toolCalls: [], resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', finishReason: 'stop' });

    await runCreationCanvasAi({
      prompt: 'Create a document on the canvas', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
      onCompletion: (completion) => completions.push(completion),
      onModelDisabled: disabled,
    });

    expect(completions).toMatchObject([
      { iteration: 1, resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', toolsAdvertised: 4, toolCalls: [] },
      { iteration: 2, resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', toolsAdvertised: 4, toolCalls: [] },
    ]);
    expect(disabled).toHaveBeenCalledWith('weak/model');
  });

  it('does not invoke an explicitly selected model disabled by this session', async () => {
    await expect(runCreationCanvasAi({
      prompt: 'Create a document', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      model: 'weak/model', disabledModels: ['weak/model'],
    })).rejects.toThrow("Model 'weak/model' is disabled for this session");
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('does not let automatic routing reuse a model disabled by this session', async () => {
    await expect(runCreationCanvasAi({
      prompt: 'Create a document', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      disabledModels: ['weak/model'],
    })).rejects.toThrow("Automatic model routing is disabled for this session");
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('finishes the exact website-redesign request instead of exhausting the turn on encyclopedic search', async () => {
    const prompt = 'i have an existing website (https://burnrateos.com/) I want to improve it with a new website design. Research other websites that provide business tools and design a better UI/UX. Show me a comparisoin between the two designs. Provide step by step guidance to the new website.';
    const fetch = vi.fn(() => ({ ok: true, url: 'https://burnrateos.com/', title: 'BurnRateOS', text: 'AI C-Suite for founders' }));
    const search = vi.fn()
      .mockReturnValueOnce({ ok: true, results: [], coverage: 'encyclopedic', attribution: 'Wikipedia' })
      .mockReturnValueOnce({ ok: true, results: [{ title: 'Unrelated article', url: 'https://en.wikipedia.org/wiki/Example' }], coverage: 'encyclopedic', attribution: 'Wikipedia' });
    const addObject = vi.fn()
      .mockReturnValueOnce({ ok: true, proposed: true, object: { id: 'site-1', kind: 'website' } })
      .mockReturnValueOnce({ ok: true, proposed: true, object: { id: 'guide-1', kind: 'document' } });
    const searchCall = (id: number) => ({
      text: '', toolCalls: [{ id: `search-${id}`, name: 'builtin_web_search', args: JSON.stringify({ query: `SaaS design attempt ${id}` }) }],
    });
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'fetch-current', name: 'builtin_web_fetch', args: JSON.stringify({ url: 'https://burnrateos.com/' }) }] })
      .mockResolvedValueOnce(searchCall(1))
      .mockResolvedValueOnce(searchCall(2))
      .mockResolvedValueOnce(searchCall(3))
      .mockResolvedValueOnce(searchCall(4))
      .mockResolvedValueOnce(searchCall(5))
      .mockResolvedValueOnce({ text: 'Here is a general summary of SaaS design principles.', toolCalls: [] })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'add-site', name: 'canvas_add_object', args: JSON.stringify({ kind: 'website', title: 'BurnRateOS redesign', fields: { pages: [{ id: 'home', name: 'Home', path: '/', sections: [{ id: 'hero', kind: 'hero', heading: 'Know your runway. Decide what comes next.', body: 'One operating view for founders.', cta: 'Start free' }, { id: 'proof', kind: 'features', heading: 'Operate with confidence', items: [{ title: 'Runway', body: 'See risk before it becomes urgent.' }] }] }], websiteTheme: { style: 'technical' } } }) },
          { id: 'add-guide', name: 'canvas_add_object', args: JSON.stringify({ kind: 'document', title: 'Current vs proposed design and implementation guide', fields: { content: 'Evidence, side-by-side comparison, priorities, and step-by-step implementation guidance.', sources: ['https://burnrateos.com/'] } }) },
        ],
      });

    const answer = await runCreationCanvasAi({
      prompt,
      canvasSnapshot: '{"objects":[{"kind":"chat","title":"Brain"}]}',
      persistence: 'server',
      canvasActions: [
        { name: 'builtin_web_fetch', description: 'Fetch', parameters: { type: 'object' }, run: fetch },
        { name: 'builtin_web_search', description: 'Search', parameters: { type: 'object' }, run: search },
        { name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: addObject },
      ],
    });

    expect(fetch).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledTimes(2);
    expect(addObject).toHaveBeenCalledTimes(2);
    expect(addObject.mock.calls.map(([args]) => args.kind)).toEqual(['website', 'document']);
    expect(answer).toBe('I added the requested content to the canvas.');
    expect(mocks.streamChatCompletion.mock.calls[0][0].maxTokens).toBe(3_200);
    expect(mocks.streamChatCompletion.mock.calls[0][0].messages.some((message: { content: string }) => message.content.includes('A generic SaaS-principles summary is not completion'))).toBe(true);
    const authoringRequest = mocks.streamChatCompletion.mock.calls[6][0];
    expect(authoringRequest.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['canvas_add_object']);
    expect(authoringRequest.messages.some((message: { content: string }) => message.content.includes('research phase is over'))).toBe(true);
  });

  it('recovers an actionless C-suite teammate response and executes the canvas request', async () => {
    const addObject = vi.fn()
      .mockReturnValueOnce({ ok: true, proposed: true, object: { id: 'cto-1', kind: 'agent', title: 'CTO' } })
      .mockReturnValueOnce({ ok: true, proposed: true, object: { id: 'review-1', kind: 'document', title: 'Production readiness review' } });
    const connectObjects = vi.fn(() => ({ ok: true, proposed: true, connectionId: 'edge-1' }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({
        text: 'What specific project or feature should the CTO review?',
        toolCalls: [],
      })
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [
          { id: 'add-cto', name: 'canvas_add_object', args: JSON.stringify({ kind: 'agent', title: 'CTO', fields: { instructions: 'Review production readiness.' } }) },
          { id: 'add-review', name: 'canvas_add_object', args: JSON.stringify({ kind: 'document', title: 'Production readiness review', fields: { content: 'Architecture, security, deployment, observability, rollback, and launch gates.' } }) },
          { id: 'connect', name: 'canvas_connect_objects', args: JSON.stringify({ sourceId: 'cto-1', targetId: 'review-1', label: 'reviews' }) },
        ],
      })
      .mockResolvedValueOnce({ text: 'I added the CTO and a connected production-readiness review.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'Bring the CTO in to review how this ships to production',
      canvasSnapshot: '{"objects":[{"kind":"chat","title":"Brain"}]}',
      persistence: 'local',
      canvasActions: [
        { name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: addObject },
        { name: 'canvas_connect_objects', description: 'Connect', parameters: { type: 'object' }, mutates: true, run: connectObjects },
      ],
    });

    expect(answer).toBe('I added the CTO and a connected production-readiness review.');
    expect(addObject).toHaveBeenCalledTimes(2);
    expect(connectObjects).toHaveBeenCalledWith({ sourceId: 'cto-1', targetId: 'review-1', label: 'reviews' });
    const recoveryMessages = mocks.streamChatCompletion.mock.calls[1][0].messages;
    expect(recoveryMessages.some((message: { content: string }) => message.content.includes('prior response did not execute'))).toBe(true);
  });

  it('does not force a canvas mutation for an informational executive-role question', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'A CTO leads the technology strategy.', toolCalls: [] });

    const answer = await runCreationCanvasAi({
      prompt: 'What does a CTO do?', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
    });

    expect(answer).toBe('A CTO leads the technology strategy.');
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
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
