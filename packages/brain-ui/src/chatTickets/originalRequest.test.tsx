import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatTicketsPanel } from './ChatTicketsPanel';
import { chatTicketsLabelsFromBundle } from './labelBundle';
import { DEFAULT_CHAT_TICKETS_LABELS } from './types';

/**
 * THE TICKET INFO AREA MUST SHOW THE REQUEST THE CHAT WAS MADE FROM.
 *
 * A Brain chat records its auto-generated title (~60 chars, derived) but not the
 * prompt that produced it, so a chat linked to a ticket kept its origin text only in
 * scrollback. These lock what the shared panel renders for `originalRequest`: the
 * label and the verbatim text, both from the HOST's bundle, read-only (no edit
 * affordance anywhere in the markup), and — the important one — NOTHING AT ALL when
 * the chat has no captured request, so every pre-migration chat looks untouched.
 */

const labels = DEFAULT_CHAT_TICKETS_LABELS;

/** The panel needs a read adapter + a chat before it will render anything. */
function adapter() {
  return {
    list: async () => [],
    read: async () => ({ tickets: [], spend: null }),
    create: async () => { throw new Error('not used'); },
    update: async () => { throw new Error('not used'); },
    remove: async () => { throw new Error('not used'); },
  } as never;
}

describe('original-request line', () => {
  const panel = (originalRequest: string | null | undefined, useLabels = labels) => (
    <ChatTicketsPanel
      chatId={7}
      projectId={null}
      chatList={[{ id: 7, title: 'Billing webhook' }]}
      adapter={adapter()}
      labels={useLabels}
      originalRequest={originalRequest}
    />
  );
  it('carries both label keys on the labels interface with English defaults', () => {
    // A host can override either half independently; both must exist or the panel
    // would have to hardcode one of them.
    expect(typeof labels.originalRequest).toBe('string');
    expect(labels.originalRequest.length).toBeGreaterThan(0);
    expect(typeof labels.originalRequestText).toBe('function');
    expect(labels.originalRequestText('x')).toContain('x');
  });

  it('interpolates the request into the template without swallowing it', () => {
    // Long/odd text must survive intact — the template only wraps it.
    const text = 'Rewrite the billing webhook to be idempotent.\n  Use `events.id`.';
    expect(labels.originalRequestText(text)).toContain(text);
    expect(labels.originalRequestText(text)).not.toContain('{text}');
  });

  it('renders the label and the verbatim request when the chat has one', () => {
    const html = renderToStaticMarkup(panel('Rewrite the billing webhook'));
    expect(html).toContain('Original request');
    expect(html).toContain('Rewrite the billing webhook');
    // Read-only history, not an editable field.
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
  });

  it('renders NOTHING when the chat has no captured request', () => {
    // The pre-migration case: absent ⇒ byte-identical to before, so no empty row or
    // placeholder appears on every existing chat.
    for (const originalRequest of [undefined, null, '', '   ']) {
      const html = renderToStaticMarkup(panel(originalRequest));
      expect(html).not.toContain('Original request');
    }
  });

  it('uses the HOST label, never a hardcoded English string', () => {
    const de = chatTicketsLabelsFromBundle({
      'ct.originalRequest': 'Ursprüngliche Anfrage',
      'ct.originalRequestText': 'Ursprüngliche Anfrage: {text}',
    });
    const html = renderToStaticMarkup(panel('Rewrite the billing webhook', de));
    expect(html).toContain('Ursprüngliche Anfrage');
    expect(html).not.toContain('Original request');
  });
});