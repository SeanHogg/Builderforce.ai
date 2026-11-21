import { describe, expect, it } from 'vitest';
import { gatherChatDiagnostics } from './gatherChatDiagnostics';
import { withInjectedMeta } from './injectedTurn';

// VS Code chat #157440 (fix round): the runtime never lets an INJECTED user row (the editor's Resume continuation, quoting a
// sub-agent brief that ends "Do not commit.") set the publish hold, but diagnostics re-derived the hold from every user row
// and reported one the runtime did not hold. The report now skips injected rows, so the two agree.

const RESUME = 'Resume the interrupted run. Sub-agent brief: refactor the parser. Do not commit.';

describe('regression: chat #157440 — diagnostics re-derive the publish hold without injected turns', () => {
  it('control: the same words typed by the person hold publishing', async () => {
    const d = await gatherChatDiagnostics({ surface: 'test', messages: [{ role: 'user', content: RESUME }] });
    expect(d.shipPolicy?.mode).toBe('leave_uncommitted');
  });

  it('regression: an injected row (metadata as a JSON string) sets no hold', async () => {
    const d = await gatherChatDiagnostics({ surface: 'test', messages: [{ role: 'user', content: RESUME, metadata: JSON.stringify(withInjectedMeta()) }] });
    expect(d.shipPolicy).toBeNull();
  });

  it('an injected row as a parsed metadata object sets no hold either', async () => {
    const d = await gatherChatDiagnostics({ surface: 'test', messages: [{ role: 'user', content: RESUME, metadata: withInjectedMeta({ source: 'resume' }) }] });
    expect(d.shipPolicy).toBeNull();
  });
});
