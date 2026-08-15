import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/i18n/messages/en.json';
import { canvasNoticesFrom, type CanvasNoticeTranslator } from './canvasNotices';

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

/**
 * Runtime notices come from the CATALOG now, not from string literals in the runner, so
 * the suite binds the real `en.json` rather than restating the English. A missing key or
 * a broken ICU message therefore fails here instead of reaching a user.
 */
const translateNotice = createTranslator({ locale: 'en', messages: en as never, namespace: 'creationCanvas.notice' as never });
const NOTICES = canvasNoticesFrom(((key, values) => translateNotice(key as never, values as never)) as CanvasNoticeTranslator);
const runTurn = (options: Omit<Parameters<typeof runCreationCanvasAi>[0], 'notices'>) =>
  runCreationCanvasAi({ ...options, notices: NOTICES });

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

    const answer = await runTurn({
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
    //
    // Only the PREFIX is asserted. The career pack that follows is served by
    // `/api/guest/career/tools`, and re-typing a server-owned list here is the
    // two-hand-written-lists defect `guestCareerActions.ts` documents — it is also what
    // made this expectation stale (and this whole file red) when that pack landed.
    const advertised = firstRequest.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(advertised.slice(0, 4)).toEqual([
      'canvas_add_object', 'builtin_web_search', 'builtin_web_fetch', 'builtin_geo_geocode',
    ]);
    expect(new Set(advertised).size).toBe(advertised.length);
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

    const answer = await runTurn({
      prompt: 'Use Home, About, Services, and Contact and change the headline for Acme Analytics.',
      canvasSnapshot: JSON.stringify({ scope: 'selection', selectedObjectIds: ['site-1'], objects: [{ id: 'site-1', kind: 'website', title: 'Acme', mutableFields: ['pages', 'websiteTheme'] }] }),
      persistence: 'local',
      canvasActions: [{ name: 'canvas_update_object', description: 'Update', parameters: { type: 'object' }, mutates: true, run: update }],
    });

    expect(update).toHaveBeenCalledWith({ objectId: 'site-1', fields: { pages, websiteTheme: { style: 'technical', accent: '#28c9b7' } } });
    expect(answer).toContain('updated the selected website');
    expect(mocks.streamChatCompletion.mock.calls[1][0].messages.some((message: { content: string }) => message.content.includes('prior response described or discussed'))).toBe(true);
  });

  it('captures resolved model provenance for every iteration, and retires nothing it cannot replace', async () => {
    const completions: unknown[] = [];
    const disabled = vi.fn();
    const stalled = { text: 'I will create it.', toolCalls: [], resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', finishReason: 'stop' };
    mocks.streamChatCompletion
      .mockResolvedValueOnce(stalled)
      .mockResolvedValueOnce({ ...stalled, text: 'Tell me what to create.' })
      // There is no proven model to hand the turn to, so the ladder spends its second
      // act-now escalation here rather than giving up three rungs early.
      .mockResolvedValueOnce({ ...stalled, text: 'Here is what the document would say.' });

    await runTurn({
      prompt: 'Create a document on the canvas', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
      onCompletion: (completion) => completions.push(completion),
      onModelDisabled: disabled,
    });

    expect(completions).toMatchObject([
      { iteration: 1, resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', toolCalls: [] },
      { iteration: 2, resolvedModel: 'weak/model', resolvedVendor: 'weak-provider', account: 'shared', toolCalls: [] },
      { iteration: 3, resolvedModel: 'weak/model', toolCalls: [] },
    ]);
    // Counted RELATIVE to the first iteration, never as a literal: the guest career pack
    // is server-owned and its size is not this test's business. What is: once the model
    // has ignored an act-now directive, the three research tools are WITHDRAWN, so it
    // cannot spend the authoring attempts on the tools it was already stalling on.
    const advertised = (completions as Array<{ toolsAdvertised: number }>).map((c) => c.toolsAdvertised);
    expect(advertised[1]).toBe(advertised[0] - 3);
    expect(advertised[2]).toBe(advertised[0] - 3);
    // `weak/model` refused twice, but it was the ONLY model this turn ever reached, so
    // retiring it would leave the session with nothing to route to — see the
    // "does not disable the only model available" case. Retirement requires a
    // replacement, which the tool-calling-fallback test covers.
    expect(disabled).not.toHaveBeenCalled();
  });

  it('does not invoke an explicitly selected model disabled by this session', async () => {
    await expect(runTurn({
      prompt: 'Create a document', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      model: 'weak/model', disabledModels: ['weak/model'],
    })).rejects.toThrow("Model 'weak/model' is disabled for this session");
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  /**
   * The session-bricking regression. Auto-routing used to REFUSE to run once it had
   * landed on a model that would not execute a command, advising the user to "select a
   * different model" — advice a free-plan visitor cannot act on, and which the guest
   * gateway makes impossible anyway (it deletes any pin). Every later turn then died in
   * ~30ms without reaching a model (measured 2026-08-12, ui 2026.7.212).
   */
  it('routes AROUND a previously-failed model instead of refusing to run', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Here is the plan.', toolCalls: [], resolvedModel: 'other/model', finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'What should I know about SEO?', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      disabledModels: ['weak/model'],
    });

    expect(answer).toBe('Here is the plan.');
    expect(mocks.streamChatCompletion.mock.calls[0][0].excludeModels).toEqual(['weak/model']);
  });

  it('still refuses an EXPLICIT pin the user can change themselves', async () => {
    await expect(runTurn({
      prompt: 'Create a document', canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
      model: 'weak/model', modelStrict: true, disabledModels: ['weak/model'],
    })).rejects.toThrow("Model 'weak/model' is disabled for this session");
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it('does not disable the only model available — that ends the session, it does not protect it', async () => {
    const disabled = vi.fn();
    mocks.streamChatCompletion.mockResolvedValue({ text: 'I will create it.', toolCalls: [], resolvedModel: 'only/model', finishReason: 'stop' });

    await runTurn({
      prompt: 'Create a campaign plan on the canvas', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
      onModelDisabled: disabled,
    });

    // No proven alternative existed, so nothing is recorded against the model and the
    // NEXT turn still has a route.
    expect(disabled).not.toHaveBeenCalled();
  });

  it('hands a stalled Canvas command back to a model that already demonstrated tool calling', async () => {
    const add = vi.fn(() => ({ ok: true, proposed: true }));
    const search = vi.fn(() => ({ ok: true, results: [] }));
    const disabled = vi.fn();
    const fallback = vi.fn();
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', resolvedModel: 'minimaxai/minimax-m3', toolCalls: [{ id: 's1', name: 'builtin_web_search', args: '{"query":"site"}' }], finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: '', resolvedModel: 'minimaxai/minimax-m3', toolCalls: [{ id: 's2', name: 'builtin_web_search', args: '{"query":"seo"}' }], finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: 'I will create the guide.', resolvedModel: 'googleai/gemini-2.5-flash', toolCalls: [], finishReason: 'stop' })
      .mockResolvedValueOnce({ text: 'I still need to create it.', resolvedModel: 'googleai/gemini-2.5-flash', toolCalls: [], finishReason: 'stop' })
      .mockResolvedValueOnce({ text: '', resolvedModel: 'minimaxai/minimax-m3', toolCalls: [{ id: 'a1', name: 'canvas_add_object', args: '{"kind":"document","title":"SEO guide","fields":{"content":"Improve titles and visual hierarchy."}}' }], finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: 'I created the SEO and visual-improvement guide.', resolvedModel: 'minimaxai/minimax-m3', toolCalls: [], finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'Improve my website and provide an SEO and visual appeal guide.',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [
        { name: 'builtin_web_search', description: 'Search', parameters: { type: 'object' }, run: search },
        { name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: add },
      ],
      onModelDisabled: disabled,
      onModelFallback: fallback,
    });

    expect(disabled).toHaveBeenCalledWith('googleai/gemini-2.5-flash');
    expect(fallback).toHaveBeenCalledWith('minimaxai/minimax-m3');
    expect(mocks.streamChatCompletion.mock.calls[1][0]).toMatchObject({ model: 'minimaxai/minimax-m3', modelStrict: false });
    expect(mocks.streamChatCompletion.mock.calls[4][0]).toMatchObject({ model: 'minimaxai/minimax-m3', modelStrict: true });
    expect(add).toHaveBeenCalledOnce();
    expect(answer).toContain('created the SEO');
  });

  /**
   * The measured public-canvas failure, 2026-08-12 (ui 2026.7.210): the transcript's
   * last assistant line was a failure notice, and the free model returned it back
   * verbatim with a "Brain: " prefix — 15 completion tokens, zero tool calls — which
   * the surface presented as a fresh answer and stored, compounding the prefix on the
   * turn after it.
   */
  it('retries instead of accepting a reply that just repeats the previous assistant message', async () => {
    const add = vi.fn(() => ({ ok: true, proposed: true }));
    const conversation = [
      { role: 'user' as const, content: 'i want to connect my email and run a marketing campaign' },
      { role: 'assistant' as const, content: "I couldn't prepare any canvas changes from that request." },
    ];
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: "Brain: I couldn't prepare any canvas changes from that request.", toolCalls: [], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'a1', name: 'canvas_add_object', args: '{"kind":"emailCampaign","title":"Launch campaign"}' }], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: 'I drafted the campaign on the canvas.', toolCalls: [], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'I want to connect my email and run a marketing campaign',
      canvasSnapshot: '{"objects":[]}', persistence: 'local', conversation,
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: add }],
    });

    expect(add).toHaveBeenCalledOnce();
    expect(answer).toBe('I drafted the campaign on the canvas.');
    expect(mocks.streamChatCompletion.mock.calls[1][0].messages.some(
      (message: { content: string }) => message.content.includes('repeated an earlier message'),
    )).toBe(true);
  });

  it('strips a speaker label the model copied onto its own answer', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Brain: Here is what SEO work matters most.', toolCalls: [], finishReason: 'stop' });

    await expect(runTurn({
      prompt: 'What should I know about SEO?',
      canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
    })).resolves.toBe('Here is what SEO work matters most.');
  });

  /**
   * The measured Creation Canvas failure, 2026-08-14 (ui 2026.8.15). "help me write an
   * email to my boss asking for a raise. Provide coaching on how to get a raise" — a
   * drafting request the canvas exists to serve — ran for 71 seconds, produced the email
   * and the coaching TWICE, and showed the user "I couldn't prepare any canvas changes
   * from that request." The model never called canvas_add_object, so both answers were
   * discarded and the only copy of the work went with them.
   *
   * Not creating the object is a shortfall. Destroying the answer is data loss, and it is
   * the half the user actually feels.
   */
  it('delivers the answer a stalled model DID give instead of destroying it for a dead-end notice', async () => {
    const unanswered = vi.fn();
    const add = vi.fn(() => ({ ok: true, proposed: true }));
    const draft = 'Subject: Reviewing my compensation\n\nHi Dana, I would like to discuss my salary at our next 1:1.';
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: draft, toolCalls: [], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: `${draft}\n\nAsk for a specific number backed by market data.`, toolCalls: [], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'stop' })
      .mockResolvedValueOnce({ text: `${draft}\n\nOpen with the impact you delivered this year.`, toolCalls: [], resolvedModel: 'minimaxai/minimax-m3', finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'help me write an email to my boss asking for a raise. Provide coaching on how to get a raise',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: add }],
      onUnanswered: unanswered,
    });

    expect(add).not.toHaveBeenCalled();
    expect(answer).toContain('Reviewing my compensation');
    expect(answer).toContain('impact you delivered this year');
    // Honest about the board, without throwing the work away to say so.
    expect(answer).toContain('did not put anything on the canvas');
    // It is a real answer, so it belongs in the transcript — a runtime notice does not.
    expect(unanswered).not.toHaveBeenCalled();
    // Three rungs were spent before giving up, not one.
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(3);
    const directives = mocks.streamChatCompletion.mock.calls[2][0].messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content).join('\n');
    expect(directives).toContain('Prose in a reply is NOT a canvas artifact');
  });

  it('reports a runtime notice as UNANSWERED so the surface keeps it out of the transcript', async () => {
    const unanswered = vi.fn();
    mocks.streamChatCompletion.mockResolvedValue({ text: '', toolCalls: [], resolvedModel: 'weak/model', finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'Create a campaign plan on the canvas',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
      onUnanswered: unanswered,
    });

    expect(answer).toBe("I couldn't prepare any canvas changes from that request.");
    expect(unanswered).toHaveBeenCalledWith({ reason: 'command-not-executed' });
  });

  it('retries a turn TRUNCATED at the output ceiling with a smaller-output directive, not "you repeated yourself"', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      // The model was mid-way through authoring canvas_add_object when the ceiling
      // cut it off, so the call never reaches us — indistinguishable from silence
      // except for finishReason.
      .mockResolvedValueOnce({ text: 'Here is the launch plan for', toolCalls: [], resolvedModel: 'weak/model', finishReason: 'length' })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'a1', name: 'canvas_add_object', args: '{"kind":"document","title":"Launch plan","fields":{"content":"Week 1: brief."}}' }], resolvedModel: 'weak/model', finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: 'I added the launch plan.', toolCalls: [], resolvedModel: 'weak/model', finishReason: 'stop' });

    const answer = await runTurn({
      prompt: 'Create a launch plan on the canvas',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(answer).toBe('I added the launch plan.');
    const directives = mocks.streamChatCompletion.mock.calls[1][0].messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content).join('\n');
    expect(directives).toContain('cut off at the output limit');
    expect(directives).not.toContain('repeated an earlier message');
  });

  it('retries an unparseable tool call by re-encoding it rather than asking for an answer', async () => {
    const run = vi.fn(() => ({ ok: true, proposed: true }));
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [], resolvedModel: 'googleai/gemini-2.5-flash', finishReason: 'MALFORMED_FUNCTION_CALL' })
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'a1', name: 'canvas_add_object', args: '{"kind":"document","title":"Launch plan","fields":{"content":"Week 1: brief."}}' }], resolvedModel: 'googleai/gemini-2.5-flash', finishReason: 'tool_calls' })
      .mockResolvedValueOnce({ text: 'I added the launch plan.', toolCalls: [], resolvedModel: 'googleai/gemini-2.5-flash', finishReason: 'stop' });

    const trace = vi.fn();
    const answer = await runTurn({
      prompt: 'Create a launch plan on the canvas',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
      onTrace: trace,
    });

    expect(answer).toBe('I added the launch plan.');
    const directives = mocks.streamChatCompletion.mock.calls[1][0].messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content).join('\n');
    expect(directives).toContain('could not be parsed');
    // The discarded attempt is recorded: a run that looks like "0 tool calls" in the
    // report was actually a model trying to act.
    expect(trace.mock.calls.some((call: unknown[]) => {
      const event = call[0] as { label?: string; isError?: boolean } | undefined;
      return event?.label === 'malformed tool call' && event.isError === true;
    })).toBe(true);
  });

  it('tells an anonymous canvas which capabilities need an account instead of leaving it to guess', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Signing up unlocks the mailbox; here is the plan meanwhile.', toolCalls: [], finishReason: 'stop' });

    await runTurn({
      prompt: 'I want to connect my email and run a marketing campaign',
      canvasSnapshot: '{"objects":[]}', persistence: 'local', canvasActions: [],
    });

    const systemBlocks = mocks.streamChatCompletion.mock.calls[0][0].messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content).join('\n');
    expect(systemBlocks).toContain('This is an ANONYMOUS canvas');
    expect(systemBlocks).toContain('Never answer a request like that with a refusal alone');
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

    const answer = await runTurn({
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

    const answer = await runTurn({
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

    const answer = await runTurn({
      prompt: 'What does a CTO do?', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
    });

    expect(answer).toBe('A CTO leads the technology strategy.');
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
  });

  it('does not rewrite an informational answer merely because it names an artifact', async () => {
    const answerText = 'CommonMark is a standardized document format; Atom or RSS exposes blog updates across platforms.';
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: answerText, toolCalls: [] });

    const answer = await runTurn({
      prompt: 'What is a standard cross-platform headless blog format?',
      canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: vi.fn() }],
    });

    expect(answer).toBe(answerText);
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
  });

  it('runs an invited Canvas agent under its own identity and instructions', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'I recommend validating demand before expanding scope.', toolCalls: [] });

    const answer = await runTurn({
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

    const answer = await runTurn({
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

    const answer = await runTurn({
      prompt: 'write a 1 page document', canvasSnapshot: '{"objects":[]}', persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run }],
    });

    expect(answer).toBe('I created the requested one-page document.');
  });

  it('corrects a false completion claim on a follow-up status question', async () => {
    mocks.streamChatCompletion.mockResolvedValueOnce({ text: 'Yes, I am creating it now. I added the 400-page document.', toolCalls: [] });

    const answer = await runTurn({
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

    const answer = await runTurn({
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

    const answer = await runTurn({
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

    const answer = await runTurn({
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

    await runTurn({
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

    await runTurn({
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

    await runTurn({
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

    const answer = await runTurn({
      prompt: 'Use this data set to visualize as a table', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local', canvasActions: [],
    });

    expect(answer).toContain('did not actually make one');
    expect(answer).not.toContain('I have created a table');
  });

  it('keeps a creation claim when a canvas mutation really was proposed', async () => {
    mocks.streamChatCompletion
      .mockResolvedValueOnce({ text: '', toolCalls: [{ id: 'c1', name: 'canvas_query_dataset', args: JSON.stringify({ materializeAs: 'table' }) }] })
      .mockResolvedValueOnce({ text: 'I have created a table from all 812 rows.', toolCalls: [] });

    const answer = await runTurn({
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

    const answer = await runTurn({
      prompt: 'visualize it', canvasSnapshot: DATASET_SNAPSHOT, persistence: 'local',
      canvasActions: [{ name: 'canvas_add_object', description: 'Add', parameters: { type: 'object' }, mutates: true, run: () => ({ ok: true, proposed: true }) }],
    });

    expect(answer).toContain('Those figures are not real');
  });
});
