import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline } from '../BrainTimeline';

const msg = (id: number, role: string, content: string): BrainMessage => ({
  id, role, content, metadata: null, seq: id, createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

describe('renderAfterMessage', () => {
  it('puts the host block under the reply it names, after the footer line, and nowhere else', () => {
    const html = renderToStaticMarkup(
      <BrainTimeline
        messages={[msg(1, 'user', 'fix it'), msg(2, 'assistant', 'Done.'), msg(3, 'user', 'again'), msg(4, 'assistant', 'Done again.')]}
        trace={[]}
        streamingText=""
        isRunning={false}
        renderAfterMessage={(m) => (m.id === 2 ? <section data-after="2">card</section> : null)}
      />,
    );
    expect(html.match(/data-after=/g)).toHaveLength(1);
    // After reply 2's footer, before the next user turn.
    expect(html.indexOf('data-after="2"')).toBeGreaterThan(html.indexOf('Done.'));
    expect(html.indexOf('data-after="2"')).toBeGreaterThan(html.indexOf('bf-tl__foot'));
    expect(html.indexOf('data-after="2"')).toBeLessThan(html.indexOf('again'));
  });
});
