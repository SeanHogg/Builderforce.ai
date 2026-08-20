import { describe, expect, it } from 'vitest';
import {
  normalizeEvermindTools,
  resolveEvermindToolChoice,
  planEvermindToolCall,
  renderToolsPreamble,
  toOpenAIToolCall,
  type EvermindToolDecoder,
  type NormalizedTool,
} from './evermindToolCall';

/**
 * A scripted stand-in for the SSM. `prefer` gives a continuation a higher score by
 * substring match, so a test can say "this head favours read_file" without training
 * anything; everything unmatched scores 0, which is what makes "the head has no
 * preference" (margin 0) directly expressible.
 */
function fakeDecoder(opts: {
  prefer?: Record<string, number>;
  generate?: (prompt: string) => string;
} = {}): EvermindToolDecoder & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    score(prompt, continuation) {
      prompts.push(prompt);
      let best = 0;
      for (const [needle, weight] of Object.entries(opts.prefer ?? {})) {
        if (continuation.includes(needle)) best = Math.max(best, weight);
      }
      return best;
    },
    generate(prompt) {
      prompts.push(prompt);
      return opts.generate ? opts.generate(prompt) : 'generated-value';
    },
  };
}

const READ_FILE: NormalizedTool = {
  name: 'read_file',
  description: 'Read a file from the repo',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'repo-relative path' } }, required: ['path'] },
};
const OPEN_PR: NormalizedTool = {
  name: 'open_pull_request',
  description: 'Open a pull request',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};

describe('normalizeEvermindTools', () => {
  it('accepts BOTH the nested chat-completions shape and the flattened Responses shape', () => {
    const tools = normalizeEvermindTools([
      { type: 'function', function: { name: 'nested', description: 'n', parameters: { type: 'object' } } },
      { type: 'function', name: 'flat', description: 'f', parameters: { type: 'object' } },
    ]);
    // The gateway carries both spellings; understanding only one would silently
    // present the head with zero tools and send every turn down the prose path.
    expect(tools.map((t) => t.name)).toEqual(['nested', 'flat']);
  });

  it('drops entries with no usable name rather than half-registering them', () => {
    expect(normalizeEvermindTools([{ type: 'function', function: { description: 'no name' } }, 'junk', null])).toEqual([]);
  });

  it('defaults a missing parameters schema to an object so the filler always has a node', () => {
    expect(normalizeEvermindTools([{ type: 'function', function: { name: 'bare' } }])[0]!.parameters).toEqual({ type: 'object' });
  });

  it('returns empty for a non-array', () => {
    expect(normalizeEvermindTools(undefined)).toEqual([]);
  });
});

describe('resolveEvermindToolChoice', () => {
  const tools = [READ_FILE, OPEN_PR];

  it('maps the string forms', () => {
    expect(resolveEvermindToolChoice('none', tools)).toEqual({ mode: 'none' });
    expect(resolveEvermindToolChoice('required', tools)).toEqual({ mode: 'required' });
    expect(resolveEvermindToolChoice('auto', tools)).toEqual({ mode: 'auto' });
    expect(resolveEvermindToolChoice(undefined, tools)).toEqual({ mode: 'auto' });
  });

  it('pins a named function in either spelling', () => {
    expect(resolveEvermindToolChoice({ type: 'function', function: { name: 'read_file' } }, tools)).toEqual({ mode: 'forced', name: 'read_file' });
    expect(resolveEvermindToolChoice({ type: 'function', name: 'open_pull_request' }, tools)).toEqual({ mode: 'forced', name: 'open_pull_request' });
  });

  it('degrades a pin on an UNDECLARED function to `required`', () => {
    // Forcing a name the caller never offered would emit a call no agent loop can
    // dispatch; requiring *some* tool is the closest honest reading.
    expect(resolveEvermindToolChoice({ type: 'function', function: { name: 'ghost' } }, tools)).toEqual({ mode: 'required' });
  });

  it('is `none` when no tools were offered at all, whatever the caller asked for', () => {
    expect(resolveEvermindToolChoice('required', [])).toEqual({ mode: 'none' });
  });
});

describe('planEvermindToolCall', () => {
  it('picks the tool the head scores highest and fills its required argument', () => {
    const decoder = fakeDecoder({ prefer: { read_file: 5 }, generate: () => 'src/index.ts' });
    const plan = planEvermindToolCall(decoder, 'user: show me the entrypoint', [READ_FILE, OPEN_PR], { mode: 'auto' });
    expect(plan.call).toEqual({ name: 'read_file', arguments: { path: 'src/index.ts' } });
    expect(plan.margin).toBeGreaterThan(0);
  });

  it('reports margin 0 when the head ranks every candidate identically', () => {
    // The whole point of the margin: a structurally perfect call chosen at random is
    // still a coin flip, and the vendor refuses on exactly this signal.
    const plan = planEvermindToolCall(fakeDecoder(), 'user: do something', [READ_FILE, OPEN_PR], { mode: 'required' });
    expect(plan.call).not.toBeNull();
    expect(plan.margin).toBe(0);
  });

  it('answers directly when "no tool" out-scores every tool (auto only)', () => {
    const decoder = fakeDecoder({ prefer: { 'answer the user directly': 9 } });
    expect(planEvermindToolCall(decoder, 'user: hello', [READ_FILE], { mode: 'auto' }).call).toBeNull();
  });

  it('NEVER answers directly under `required`, even when prose would have won', () => {
    const decoder = fakeDecoder({ prefer: { 'answer the user directly': 9 } });
    expect(planEvermindToolCall(decoder, 'user: hello', [READ_FILE], { mode: 'required' }).call?.name).toBe('read_file');
  });

  it('honours a forced tool without holding a vote at all', () => {
    // A forced choice is unopposed, so it must not be judged as a low-confidence
    // guess — otherwise the vendor would refuse a call the CALLER chose.
    const decoder = fakeDecoder({ prefer: { read_file: 9 } });
    const plan = planEvermindToolCall(decoder, 'user: x', [READ_FILE, OPEN_PR], { mode: 'forced', name: 'open_pull_request' });
    expect(plan.call?.name).toBe('open_pull_request');
    expect(plan.margin).toBe(Infinity);
  });

  it('returns no call when tool_choice is none', () => {
    expect(planEvermindToolCall(fakeDecoder(), 'x', [READ_FILE], { mode: 'none' }).call).toBeNull();
  });

  it('shows the head the tool catalogue, so the choice is informed by descriptions', () => {
    const decoder = fakeDecoder({ prefer: { read_file: 1 } });
    planEvermindToolCall(decoder, 'user: x', [READ_FILE], { mode: 'required' });
    expect(decoder.prompts.some((p) => p.includes('Read a file from the repo'))).toBe(true);
  });
});

describe('argument filling is constrained by the schema', () => {
  it('always yields a legal `enum` value, never a generated one', () => {
    const tool: NormalizedTool = {
      name: 'set_status', description: '',
      parameters: { type: 'object', properties: { status: { enum: ['open', 'closed'] } }, required: ['status'] },
    };
    // The head "wants" to say something off-menu; an enum is a vote, not a generation,
    // so an illegal value is unrepresentable.
    const decoder = fakeDecoder({ prefer: { closed: 3 }, generate: () => 'banana' });
    expect(planEvermindToolCall(decoder, 'x', [tool], { mode: 'required' }).call?.arguments).toEqual({ status: 'closed' });
  });

  it('produces real booleans and numbers, not their string spellings', () => {
    const tool: NormalizedTool = {
      name: 'paginate', description: '',
      parameters: { type: 'object', properties: { recursive: { type: 'boolean' }, limit: { type: 'integer' } }, required: ['recursive', 'limit'] },
    };
    const decoder = fakeDecoder({ prefer: { true: 2 }, generate: () => 'about 25 items' });
    expect(planEvermindToolCall(decoder, 'x', [tool], { mode: 'required' }).call?.arguments).toEqual({ recursive: true, limit: 25 });
  });

  it('clamps a number to the schema bounds and falls back when the head emits none', () => {
    const tool: NormalizedTool = {
      name: 'paginate', description: '',
      parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['limit'] },
    };
    expect(planEvermindToolCall(fakeDecoder({ generate: () => '9999' }), 'x', [tool], { mode: 'required' }).call?.arguments).toEqual({ limit: 10 });
    // No digits at all → the schema's own floor, not NaN.
    expect(planEvermindToolCall(fakeDecoder({ generate: () => 'lots' }), 'x', [tool], { mode: 'required' }).call?.arguments).toEqual({ limit: 1 });
  });

  it('omits an OPTIONAL argument the head declines, and keeps required ones', () => {
    const tool: NormalizedTool = {
      name: 'search', description: '',
      parameters: { type: 'object', properties: { query: { type: 'string' }, caseSensitive: { type: 'boolean' } }, required: ['query'] },
    };
    const decoder = fakeDecoder({ prefer: { no: 5 }, generate: () => 'needle' });
    expect(planEvermindToolCall(decoder, 'x', [tool], { mode: 'required' }).call?.arguments).toEqual({ query: 'needle' });
  });

  it('fills nested objects and arrays', () => {
    const tool: NormalizedTool = {
      name: 'commit', description: '',
      parameters: {
        type: 'object',
        properties: {
          author: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          files: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
        },
        required: ['author', 'files'],
      },
    };
    const plan = planEvermindToolCall(fakeDecoder({ generate: () => 'x.ts' }), 'x', [tool], { mode: 'required' });
    expect(plan.call?.arguments).toEqual({ author: { name: 'x.ts' }, files: ['x.ts', 'x.ts'] });
  });

  it('takes the WEAKEST link as the plan margin (a confident tool with a coin-flip enum is a coin flip)', () => {
    const tool: NormalizedTool = {
      name: 'set_status', description: '',
      parameters: { type: 'object', properties: { status: { enum: ['open', 'closed'] } }, required: ['status'] },
    };
    // Only ONE tool, so the tool vote is unopposed (Infinity) — but the enum is a tie.
    expect(planEvermindToolCall(fakeDecoder(), 'x', [tool], { mode: 'required' }).margin).toBe(0);
  });
});

describe('structural validity is guaranteed by construction', () => {
  it('survives a head that emits quotes, braces and newlines as an argument value', () => {
    const tool: NormalizedTool = {
      name: 'write_note', description: '',
      parameters: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    };
    // This is the case free-form JSON generation gets wrong every time. Here the
    // value is escaped at assembly, so the wire form is still parseable JSON.
    const hostile = 'he said "hi" } , { \n and then \\ broke';
    const plan = planEvermindToolCall(fakeDecoder({ generate: () => hostile }), 'x', [tool], { mode: 'required' });
    const wire = toOpenAIToolCall(plan.call!, 'call_1') as { function: { name: string; arguments: string } };
    expect(() => JSON.parse(wire.function.arguments)).not.toThrow();
    expect(JSON.parse(wire.function.arguments).body).toContain('he said');
    expect(wire.function.name).toBe('write_note');
  });

  it('bottoms out instead of recursing forever on a self-referential schema', () => {
    const recursive: NormalizedTool = { name: 'deep', description: '', parameters: { type: 'object' } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recursive.parameters as any).properties = { child: recursive.parameters };
    (recursive.parameters as { required?: string[] }).required = ['child'];
    const plan = planEvermindToolCall(fakeDecoder(), 'x', [recursive], { mode: 'required' });
    expect(() => JSON.stringify(plan.call!.arguments)).not.toThrow();
  });
});

describe('renderToolsPreamble', () => {
  it('renders a readable signature with optionality and enum members', () => {
    const preamble = renderToolsPreamble([
      READ_FILE,
      { name: 'set_status', description: 'Set it', parameters: { type: 'object', properties: { status: { enum: ['open', 'closed'] } } } },
    ]);
    expect(preamble).toContain('read_file(path: string) — Read a file from the repo');
    expect(preamble).toContain('set_status(status?: "open"|"closed")');
  });
});

describe('planEvermindToolCall — parallel calls', () => {
  it('emits ONE call when the head does not want another', () => {
    // The default shape: a model with nothing more to do must still emit exactly one
    // call, or every single-call turn would grow a spurious second one.
    const plan = planEvermindToolCall(
      fakeDecoder({ prefer: { read_file: 1, no: 1 } }),
      'user: show me the entrypoint',
      [READ_FILE, OPEN_PR],
      { mode: 'auto' },
    );
    expect(plan.calls).toHaveLength(1);
    expect(plan.call).toEqual(plan.calls[0]);
  });

  it('emits several calls when the head keeps saying yes', () => {
    // `yes` outscores `no` on the continue-vote, and the two tools alternate as the
    // preferred next call, so the planner walks up to its ceiling.
    let turn = 0;
    const decoder: EvermindToolDecoder = {
      score(_prompt, continuation) {
        if (continuation === 'yes') return 1;
        if (continuation === 'no') return 0;
        // Alternate which tool wins so successive calls are not duplicates (an exact
        // repeat is treated as looping and stops the walk).
        if (continuation.includes('read_file')) return turn % 2 === 0 ? 1 : 0.5;
        if (continuation.includes('open_pr')) return turn % 2 === 0 ? 0.5 : 1;
        return 0;
      },
      generate() { turn++; return `value-${turn}`; },
    };
    const plan = planEvermindToolCall(decoder, 'user: fix and ship it', [READ_FILE, OPEN_PR], { mode: 'auto' });

    // The OpenAI shape has always been an array; before this the planner emitted one
    // call and a caller relying on parallel calls silently got serialized behaviour.
    expect(plan.calls.length).toBeGreaterThan(1);
    expect(plan.calls.length).toBeLessThanOrEqual(4);
  });

  it('stops rather than repeat an identical call', () => {
    // A head that keeps choosing the same tool with the same arguments is LOOPING,
    // not planning parallel work — and an agent loop would faithfully execute the
    // duplicate twice.
    const decoder: EvermindToolDecoder = {
      score(_prompt, continuation) {
        if (continuation === 'yes') return 1;
        if (continuation === 'no') return 0;
        return continuation.includes('read_file') ? 1 : 0;
      },
      generate: () => 'same-value',
    };
    const plan = planEvermindToolCall(decoder, 'user: read it', [READ_FILE, OPEN_PR], { mode: 'auto' });
    expect(plan.calls).toHaveLength(1);
  });

  it('never emits more than one call for a FORCED choice', () => {
    // `forced` names exactly one tool. Asking for more would emit calls the caller
    // never requested.
    const decoder: EvermindToolDecoder = {
      score: (_p, continuation) => (continuation === 'yes' ? 1 : 0),
      generate: () => 'v',
    };
    const plan = planEvermindToolCall(decoder, 'user: go', [READ_FILE, OPEN_PR], { mode: 'forced', name: 'read_file' });
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]!.name).toBe('read_file');
  });

  it('returns no calls at all when the head answers in prose', () => {
    const plan = planEvermindToolCall(
      fakeDecoder({ prefer: { 'answer the user directly': 1 } }),
      'user: hello',
      [READ_FILE, OPEN_PR],
      { mode: 'auto' },
    );
    expect(plan.call).toBeNull();
    expect(plan.calls).toEqual([]);
  });
});
