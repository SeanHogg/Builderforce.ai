import { describe, it, expect } from 'vitest';
import {
  sanitizeToolName,
  restoreToolName,
  sanitizeParticipantName,
  sanitizeToolCallId,
  sanitizeRequestToolCalls,
  StreamingToolNameRestorer,
} from './toolNameSanitizer';

/**
 * The gateway speaks OpenAI shape and fails over across many vendors inside ONE
 * run, so a name that only some vendors accept is a run-killer: a 400 from a
 * strict vendor is classified `request_error` (the caller's bug), which is fatal
 * and stops the cascade instead of failing over.
 *
 * MEASURED (task 683): `Gateway 400 on model 'direct/meta/muse-spark-1.1' …
 * "`name` must match ^[a-zA-Z0-9_.-]+$"` terminated a cloud coding run. The
 * sanitizer's own header already promised the strict charset; it only ever
 * encoded dots.
 */
describe('sanitizeToolName — the full strict charset, reversibly', () => {
  const strict = /^[a-zA-Z0-9_-]*$/;

  it('leaves an already-valid name untouched', () => {
    expect(sanitizeToolName('read_file')).toBe('read_file');
    expect(sanitizeToolName('tasks-update')).toBe('tasks-update');
  });

  it('keeps the historical dot sentinel (in-flight conversations carry it)', () => {
    expect(sanitizeToolName('governance.snapshot')).toBe('governance__DOT__snapshot');
  });

  it.each([
    'tasks update',
    'tasks.update({ id })',
    '`tasks.update`',
    'agile/kanban:list',
    'préparer',
    'search 🔍',
  ])('emits the strict charset for %j', (name) => {
    const sanitized = sanitizeToolName(name);
    expect(sanitized).toMatch(strict);
    expect(restoreToolName(sanitized)).toBe(name);
  });

  it('round-trips a literal __DOT__ in the original name', () => {
    const name = 'weird__DOT__name.real';
    expect(restoreToolName(sanitizeToolName(name))).toBe(name);
  });

  it('is idempotent in the sense that restore fully inverts sanitize', () => {
    for (const n of ['a.b.c', 'a b c', '', 'x', '__U0041__literal']) {
      expect(restoreToolName(sanitizeToolName(n))).toBe(n);
    }
  });
});

describe('sanitizeParticipantName — cosmetic, not an identifier', () => {
  // A `messages[].name` on a user/assistant turn is a label the model reads, never
  // something the caller looks a tool up by, so it stays READABLE rather than being
  // escaped into `Sean__U0027__s`.
  it('rewrites to the strict charset and stays legible', () => {
    expect(sanitizeParticipantName("Sean's Coder")).toBe('Sean_s_Coder');
    expect(sanitizeParticipantName('Ada (reviewer)')).toBe('Ada__reviewer_');
  });

  it('leaves a valid name alone', () => {
    expect(sanitizeParticipantName('ada-reviewer_1')).toBe('ada-reviewer_1');
  });
});

describe('sanitizeRequestToolCalls', () => {
  it('sanitizes tool definitions, history tool calls and tool results together', () => {
    const out = sanitizeRequestToolCalls({
      tools: [{ type: 'function', function: { name: 'agile.kanban list' } }],
      messages: [
        { role: 'assistant', content: '', tool_calls: [{ id: 'call:1/a', type: 'function', function: { name: 'agile.kanban list' } }] },
        { role: 'tool', tool_call_id: 'call:1/a', name: 'agile.kanban list', content: 'ok' },
      ],
    }) as { tools: Array<{ function: { name: string } }>; messages: Array<Record<string, unknown>> };

    const strict = /^[a-zA-Z0-9_-]+$/;
    expect(out.tools[0]!.function.name).toMatch(strict);
    const assistant = out.messages[0] as { tool_calls: Array<{ id: string; function: { name: string } }> };
    const toolTurn = out.messages[1] as { tool_call_id: string; name: string };
    expect(assistant.tool_calls[0]!.function.name).toMatch(strict);
    expect(toolTurn.name).toMatch(strict);
    // The id rewrite is deterministic, so the call and its result stay PAIRED —
    // that pairing is what strict vendors validate when the cascade fails into them.
    expect(assistant.tool_calls[0]!.id).toBe(toolTurn.tool_call_id);
    expect(assistant.tool_calls[0]!.id).toBe(sanitizeToolCallId('call:1/a'));
  });

  it('sanitizes a PARTICIPANT name on a non-tool turn', () => {
    const out = sanitizeRequestToolCalls({
      messages: [{ role: 'user', name: 'Ada (reviewer)', content: 'hi' }],
    }) as { messages: Array<{ name: string }> };
    expect(out.messages[0]!.name).toBe('Ada__reviewer_');
  });

  it('leaves a body with no tools or names structurally unchanged', () => {
    const body = { model: 'x', messages: [{ role: 'user', content: 'hi' }] };
    expect(sanitizeRequestToolCalls(body)).toEqual(body);
  });
});

describe('StreamingToolNameRestorer — sentinels split across SSE deltas', () => {
  /** Feed a name one fragment at a time; collect what the caller would receive. */
  function stream(fragments: string[]): string {
    const restorer = new StreamingToolNameRestorer();
    let out = '';
    for (const name of fragments) {
      const chunk = { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name } }] } }] };
      restorer.restoreChunk(chunk);
      out += chunk.choices[0]!.delta.tool_calls[0]!.function.name;
    }
    return out;
  }

  it('restores a dot sentinel split mid-token', () => {
    expect(stream(['governance__D', 'OT__snap', 'shot'])).toBe('governance.snapshot');
  });

  it('restores a unicode escape split mid-token', () => {
    // `tasks update` → `tasks__U0020__update`, arriving in three fragments.
    expect(stream(['tasks__U00', '20__upd', 'ate'])).toBe('tasks update');
  });

  it('does not emit a half-formed escape while it is still ambiguous', () => {
    // After `tasks__` nothing may be committed: `__` could still become any of the
    // three encodings. Emitting it would leak `tasks__` to the caller.
    expect(stream(['tasks__'])).toBe('tasks');
  });

  it('matches the non-streamed restore for a name using every encoding', () => {
    const original = 'a.b c__DOT__d';
    const sanitized = sanitizeToolName(original);
    // One character at a time — the worst case for boundary handling.
    expect(stream([...sanitized])).toBe(restoreToolName(sanitized));
    expect(stream([...sanitized])).toBe(original);
  });
});
