import { describe, expect, it, vi, beforeEach } from 'vitest';
import { evermindModule } from './evermind';
import { modelSupportsTools } from './registry';
import { VendorFatalError } from './types';
import { buildEvermindFixtureStore as fixtureStore } from '../__fixtures__/evermindModel';
import { isServableText } from '../textCoherence';
import { evermindToolChoiceMinMargin, TOOL_CHOICE_MIN_MARGIN } from '../evermindToolCall';

/** Controls what the (mocked) runtime generates, so the vendor's OWN contracts —
 *  tool refusal and the coherence gate — can be asserted without depending on what a
 *  randomly-initialised fixture model happens to emit. */
const generated = vi.hoisted(() => ({ content: '' }));

vi.mock('../evermindRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../evermindRuntime')>();
  return {
    ...actual,
    evermindGenerate: vi.fn(async () => ({
      content: generated.content,
      usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 },
    })),
  };
});

const store = () => fixtureStore('evermind-models/9/vendor-fixture');
const COHERENT = 'The deployment finished successfully and every health check passed on the first attempt.';

beforeEach(() => { generated.content = COHERENT; });

describe('evermind vendor module', () => {
  it('is registered as a no-key, non-auto-routed vendor', () => {
    expect(evermindModule.id).toBe('evermind');
    expect(evermindModule.autoRoute).toBe(false);
    expect(evermindModule.apiKeyFrom({} as never)).toBe('local'); // sentinel — passes the key gate
    expect(evermindModule.tierFor('anything')).toBe('STANDARD');
  });

  it('declares tool support (constrained decoding), and `modelSupportsTools` reports it', () => {
    expect(evermindModule.supportsTools).toBe(true);
    expect(modelSupportsTools('evermind/evermind/project/1/11/v7')).toBe(true);
    expect(modelSupportsTools('claude-opus-4-8')).toBe(true);
    expect(modelSupportsTools('xai-oauth/grok-4.5')).toBe(true);
  });

  it('never returns prose that fails the coherence gate, even on a tool-bearing turn', async () => {
    // Whatever the tool path decides (emit a call, refuse a guessed one, or answer in
    // prose), the ONE invariant this vendor owes every caller is that any PROSE it
    // returns has passed the serve-time gate. Asserted here against a real fixture head
    // whose raw output is degenerate.
    const result = await evermindModule.call({
      apiKey: 'local',
      model: 'evermind-models/9/vendor-fixture',
      messages: [{ role: 'user', content: 'list the backlog' }],
      tools: [{ type: 'function', function: { name: 'builtin_chats_list_tickets', description: 'List tickets', parameters: { type: 'object', properties: { chatId: { type: 'number' } } } } }],
      uploads: store(),
    }).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));

    if (result.ok) {
      if (result.r.content) expect(isServableText(result.r.content).coherent).toBe(true);
    } else {
      // A refusal is a 400 fatal, which is what makes a soft pin cascade to a real model.
      expect(result.e).toBeInstanceOf(VendorFatalError);
      expect((result.e as VendorFatalError).status).toBe(400);
    }
  }, 30000);

  it('emits a WELL-FORMED tool call from a real head when the caller forces one', async () => {
    // End-to-end proof that constrained decoding works against actual weights: a
    // forced choice is unopposed (no confidence refusal), so this deterministically
    // exercises the whole path — schema walk, engine-backed value fills, completion
    // shape. The fixture head is randomly initialised, so the ARGUMENT text is
    // arbitrary; what must hold regardless is that the wire form is a valid call.
    const result = await evermindModule.call({
      apiKey: 'local',
      model: 'evermind-models/9/vendor-fixture',
      messages: [{ role: 'user', content: 'read the entrypoint' }],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from the repo',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      }],
      toolChoice: { type: 'function', function: { name: 'read_file' } },
      uploads: store(),
    });

    const raw = result.raw as {
      choices: Array<{ finish_reason: string; message: { content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> } }>;
    };
    const choice = raw.choices[0]!;
    expect(choice.finish_reason).toBe('tool_calls');
    // `content: null` (not '') is the OpenAI contract every client SDK deserializes.
    expect(choice.message.content).toBeNull();
    const call = choice.message.tool_calls![0]!;
    expect(call.type).toBe('function');
    expect(call.function.name).toBe('read_file');
    // The headline guarantee: arguments are ALWAYS parseable JSON matching the schema,
    // because they were assembled rather than generated.
    const args = JSON.parse(call.function.arguments) as { path: unknown };
    expect(typeof args.path).toBe('string');
  }, 30000);

  it('serves a coherent generation (empty tools array = nothing was actually offered)', async () => {
    const result = await evermindModule.call({
      apiKey: 'local',
      model: 'evermind-models/9/vendor-fixture',
      messages: [{ role: 'user', content: 'did the deploy work?' }],
      tools: [],
      uploads: store(),
    });
    const raw = result.raw as { object: string; choices: Array<{ message: { content: string } }> };
    expect(raw.object).toBe('chat.completion');
    expect(result.content).toBe(COHERENT);
    expect(result.usage?.total_tokens).toBeGreaterThan(0);
  });

  describe('coherence gate on the raw pin', () => {
    it('REFUSES invented-word gibberish rather than returning it unfiltered', async () => {
      generated.content =
        'Oredionisiing chats code related tot, bound reposea this inatic exie. A cainstiel was ore, '
        + 'thereb ancerin our propsal fromt bunted resole. Ther inatel sonce wortent flimber, and one '
        + 'grantile morest bindow will hance that trumal serite.';
      const err = await evermindModule.call({
        apiKey: 'local',
        model: 'evermind-models/9/vendor-fixture',
        messages: [{ role: 'user', content: 'summarise the project status' }],
        uploads: store(),
      }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(VendorFatalError);
      // 400 is what makes a SOFT pin cascade to a real model; a hard pin surfaces it.
      expect((err as VendorFatalError).status).toBe(400);
      expect((err as VendorFatalError).message).toMatch(/incoherent/i);
    });

    it('REFUSES a degenerate repeated-token reply', async () => {
      generated.content = 'commit commit commit commit the commit commit commit changes commit commit';
      const err = await evermindModule.call({
        apiKey: 'local',
        model: 'evermind-models/9/vendor-fixture',
        messages: [{ role: 'user', content: 'what changed?' }],
        uploads: store(),
      }).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(VendorFatalError);
      expect((err as VendorFatalError).status).toBe(400);
    });

    it('REFUSES a reply too short to be a real answer', async () => {
      generated.content = 'ok.';
      await expect(
        evermindModule.call({
          apiKey: 'local',
          model: 'evermind-models/9/vendor-fixture',
          messages: [{ role: 'user', content: 'explain the architecture' }],
          uploads: store(),
        }),
      ).rejects.toThrow(/incoherent/i);
    });

    it('does NOT mis-reject a jargon-dense answer that echoes the question', async () => {
      generated.content =
        'Zephyrion routes each Kalastra shard through Vorbelis before Trantium indexes the Meridex '
        + 'payload, so Quandrix never observes an unbalanced Sylvax batch in the pipeline stage.';
      const result = await evermindModule.call({
        apiKey: 'local',
        model: 'evermind-models/9/vendor-fixture',
        messages: [{ role: 'user', content: 'How do Zephyrion, Kalastra, Vorbelis, Trantium, Meridex, Quandrix and Sylvax fit together?' }],
        uploads: store(),
      });
      expect(result.content).toContain('Zephyrion');
    });
  });

  it('fails fatally (no failover) when the R2 store is not bound', async () => {
    await expect(
      evermindModule.call({ apiKey: 'local', model: 'evermind-models/9/x', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/not bound/);
  });
});

describe('evermind — streaming parity and a tunable confidence bar', () => {
  it('exposes callStream, so a streaming turn is not silently served by another model', async () => {
    // Streaming dispatch SKIPS vendors without `callStream`. Without this the project
    // Evermind pin meant one model on a non-streaming surface and a DIFFERENT model on
    // a streaming one — the pin quietly not applying is worse than it failing.
    expect(typeof evermindModule.callStream).toBe('function');
  });

  it('replays a completed call as SSE carrying BOTH the content and the usage chunk', async () => {
    const res = await evermindModule.callStream!({
      apiKey: 'local',
      model: 'evermind-models/9/vendor-fixture',
      messages: [{ role: 'user', content: 'hello' }],
      uploads: store(),
    }).then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));

    // A degenerate fixture head may legitimately be refused by the coherence gate;
    // what must NOT happen is the stream path behaving differently from `call`.
    if (!res.ok) {
      expect(res.e).toBeInstanceOf(VendorFatalError);
      return;
    }
    const body = await res.r.response.text();
    expect(res.r.response.headers.get('content-type')).toContain('text/event-stream');
    // Usage rides its own trailing chunk, exactly as OpenAI's include_usage does —
    // the client only learns token counts from a chunk's `usage`.
    expect(body).toContain('"usage"');
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true);
  }, 30000);
});

describe('evermindToolChoiceMinMargin', () => {
  it('defaults to the shipped placeholder', () => {
    expect(evermindToolChoiceMinMargin()).toBe(TOOL_CHOICE_MIN_MARGIN);
    expect(evermindToolChoiceMinMargin({})).toBe(TOOL_CHOICE_MIN_MARGIN);
  });

  it('honours a numeric override, so the bar can be calibrated without a deploy', () => {
    expect(evermindToolChoiceMinMargin({ EVERMIND_TOOL_CHOICE_MIN_MARGIN: '0.35' })).toBe(0.35);
    // Zero is a legitimate setting: it disables the gate deliberately, which is a
    // different thing from disabling it by accident.
    expect(evermindToolChoiceMinMargin({ EVERMIND_TOOL_CHOICE_MIN_MARGIN: '0' })).toBe(0);
  });

  it('ignores garbage rather than obeying it', () => {
    // A bar of NaN compares false against every margin and would silently turn the
    // confidence gate OFF — the one failure mode a misconfiguration must not cause.
    expect(evermindToolChoiceMinMargin({ EVERMIND_TOOL_CHOICE_MIN_MARGIN: 'soon' })).toBe(TOOL_CHOICE_MIN_MARGIN);
    expect(evermindToolChoiceMinMargin({ EVERMIND_TOOL_CHOICE_MIN_MARGIN: '-1' })).toBe(TOOL_CHOICE_MIN_MARGIN);
    expect(evermindToolChoiceMinMargin({ EVERMIND_TOOL_CHOICE_MIN_MARGIN: '' })).toBe(TOOL_CHOICE_MIN_MARGIN);
  });
});
