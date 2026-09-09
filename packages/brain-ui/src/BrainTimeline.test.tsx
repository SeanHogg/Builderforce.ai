import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrainMessage, BrainTraceEvent } from '@seanhogg/builderforce-brain-embedded';
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

/** A tool step between two messages — what makes a thought a mid-run narration
 *  rather than the run's last word. */
const toolAfter = (msgId: number): BrainTraceEvent[] => [{
  ts: new Date(1_700_000_000_000 + msgId * 1000 + 500).toISOString(),
  category: 'tool',
  label: 'read_file',
  args: { path: 'a.ts' },
  result: 'ok',
}];

const render = (messages: BrainMessage[], trace: BrainTraceEvent[] = [], isRunning = false) =>
  renderToStaticMarkup(
    <BrainTimeline
      messages={messages}
      trace={trace}
      streamingText=""
      isRunning={isRunning}
      onReplayMessage={() => {}}
      onRateMessage={() => {}}
      labels={{ thought: 'Thought', replyFromThought: 'From the reasoning' }}
    />,
  );

describe('<BrainTimeline> reply density', () => {
  it('collapses a reasoning-only turn to one line: no header, no actions, chip inline', () => {
    // The model thought, called a tool, and ANSWERED afterwards — the mid-run
    // narration the collapsed line is for. (Had the run stopped on the thought, the
    // reply would be rescued from it instead — see the stranded-reply tests below.)
    const all = render(
      [
        msg(1, 'user', 'fix it'),
        msg(2, 'assistant', '<think>Look at the file first.</think>', prov),
        msg(3, 'assistant', 'Patched it.', prov),
      ],
      toolAfter(2),
    );
    // Only the collapsed thought row is under test — the turns either side of it keep
    // their own header and hover actions, so the slice stops at the next list item.
    const start = all.indexOf('bf-tl__item--thought');
    const html = all.slice(start, all.indexOf('<li', start));
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

  it('shows a reply the model left inside its reasoning when the run ENDED there', () => {
    // Verbatim shape of the reported failure: the whole reply — a question — inside an
    // unclosed `<think>`, with the run over and nothing after it. Collapsed, the user
    // saw a muted "Thought" line and concluded the agent had died.
    const html = render([
      msg(1, 'user', 'close the tickets that are not aligned'),
      msg(2, 'assistant', '<think>Both are archived. Should I close them or add them to the roadmap?', prov),
    ]);
    expect(html).toContain('bf-tl__item--assistant');
    expect(html).not.toContain('bf-tl__item--thought');
    // The question is READABLE — the `<think>` scaffolding is gone, so there is no
    // disclosure left for it to hide behind.
    expect(html).toContain('Should I close them or add them to the roadmap?');
    expect(html).not.toContain('<summary>Thought</summary>');
    // …and the odd first-person voice is explained rather than left as a mystery.
    expect(html).toContain('From the reasoning');
    // A rescued reply is a reply: it gets the header, the chip and the actions.
    expect(html).toContain('bf-tl__role">BuilderForce');
    expect(html).toContain('bf-tl__prov--own');
    expect(html).toContain('aria-label="Copy"');
  });

  it('leaves a reasoning-only turn collapsed while the run is still going', () => {
    const html = render(
      [msg(1, 'user', 'fix it'), msg(2, 'assistant', '<think>Still working out the plan', prov)],
      [],
      true,
    );
    expect(html).toContain('bf-tl__item--thought');
    expect(html).not.toContain('From the reasoning');
  });

  it('copies and replays the answer alone, never the think scaffolding', () => {
    const html = render([msg(2, 'assistant', '<think>secret plan</think>The answer.')]);
    // The copy button is present (there is an answer) …
    expect(html).toContain('aria-label="Copy"');
    // … and the reasoning is only ever inside the collapsed disclosure.
    expect(html.indexOf('secret plan')).toBeGreaterThan(html.indexOf('<summary>Thought</summary>'));
  });
});
