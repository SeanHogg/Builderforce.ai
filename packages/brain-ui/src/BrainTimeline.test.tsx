import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { BrainTimeline } from './BrainTimeline';

const msg = (id: number, role: string, content: string, metadata: string | null = null): BrainMessage => ({
  id,
  role,
  content,
  metadata,
  seq: id,
  createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
});

const prov = JSON.stringify({ provenance: { model: 'direct/minimax/MiniMax-M1', account: 'own' } });

const render = (messages: BrainMessage[]) =>
  renderToStaticMarkup(
    <BrainTimeline
      messages={messages}
      trace={[]}
      streamingText=""
      isRunning={false}
      onReplayMessage={() => {}}
      onRateMessage={() => {}}
      labels={{ thought: 'Thought' }}
    />,
  );

describe('<BrainTimeline> reply density', () => {
  it('collapses a reasoning-only turn to one line: no header, no actions, chip inline', () => {
    const all = render([msg(1, 'user', 'fix it'), msg(2, 'assistant', '<think>Look at the file first.</think>', prov)]);
    // Only the assistant turn is under test — the user turn keeps its own hover actions.
    const html = all.slice(all.indexOf('bf-tl__item--thought'));
    expect(html).toContain('bf-tl__thought-line');
    expect(html).toContain('<summary>Thought</summary>');
    // Still attributed — the chip rides on the same line.
    expect(html).toContain('bf-tl__prov--own');
    // Nothing to copy, replay or grade.
    expect(html).not.toContain('bf-tl__act"');
    expect(html).not.toContain('bf-tl__actions');
    expect(html).not.toContain('bf-tl__role');
  });

  it('gives a real reply a header, the text, and ONE footer line carrying chip + actions', () => {
    const html = render([msg(1, 'user', 'fix it'), msg(2, 'assistant', '<think>plan</think>Done — patched the scroll lock.', prov)]);
    expect(html).toContain('bf-tl__item--assistant');
    expect(html).toContain('bf-tl__role">BuilderForce');
    expect(html).toContain('bf-tl__foot');
    expect(html.match(/bf-tl__foot/g)?.length).toBe(1);
    // Chip and actions are inside the footer, actions hover-revealed.
    const foot = html.slice(html.indexOf('bf-tl__foot'));
    expect(foot).toContain('bf-tl__prov--own');
    expect(foot).toContain('bf-tl__actions bf-tl__actions--hover');
    expect(foot).toContain('Good response');
  });

  it('copies and replays the answer alone, never the think scaffolding', () => {
    const html = render([msg(2, 'assistant', '<think>secret plan</think>The answer.')]);
    // The copy button is present (there is an answer) …
    expect(html).toContain('aria-label="Copy"');
    // … and the reasoning is only ever inside the collapsed disclosure.
    expect(html.indexOf('secret plan')).toBeGreaterThan(html.indexOf('<summary>Thought</summary>'));
  });
});
