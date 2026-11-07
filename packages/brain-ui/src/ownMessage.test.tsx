import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline } from './BrainTimeline';
import { ownMessageOf } from './ownMessage';

const msg = (id: number, role: string, authorUserId: string | null): BrainMessage => ({
  id, role, content: `m${id}`, metadata: null, authorUserId, seq: id, createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

function translatedIds(messages: BrainMessage[], viewer: string | null): number[] {
  const seen: number[] = [];
  renderToStaticMarkup(
    <BrainTimeline
      messages={messages}
      trace={[]}
      streamingText=""
      isRunning={false}
      isOwnMessage={ownMessageOf(viewer)}
      renderMessage={(m, ctx) => { if (ctx.translate) seen.push(m.id); return ctx.text; }}
    />,
  );
  return seen;
}

describe('ownMessageOf + <BrainTimeline> translation', () => {
  it('translates another author\'s user message, not the viewer\'s own', () => {
    expect(translatedIds([msg(1, 'user', 'me'), msg(2, 'user', 'teammate')], 'me')).toEqual([2]);
  });

  it('never translates an authorless message or when the viewer is unknown', () => {
    expect(translatedIds([msg(1, 'user', null)], 'me')).toEqual([]);
    expect(translatedIds([msg(2, 'user', 'teammate')], null)).toEqual([]);
  });
});
