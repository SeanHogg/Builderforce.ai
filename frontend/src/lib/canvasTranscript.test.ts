import { describe, expect, it } from 'vitest';

import {
  canvasTranscriptForModel,
  conversationSpeakerLabels,
  echoesEarlierAnswer,
  stripSpeakerLabel,
  type CanvasTranscriptMessage,
} from './canvasTranscript';

const message = (over: Partial<CanvasTranscriptMessage> & Pick<CanvasTranscriptMessage, 'messageRole' | 'body'>): CanvasTranscriptMessage => over;

describe('canvasTranscriptForModel', () => {
  it('never labels the human or Brain — the role already says which is which', () => {
    expect(canvasTranscriptForModel([
      message({ messageRole: 'user', body: 'improve my website', metadata: { authoredBy: { kind: 'human', ref: 'u1', name: 'You' } } }),
      message({ messageRole: 'assistant', body: 'Here is the plan.', metadata: { authoredBy: { kind: 'brain', ref: 'brain', name: 'Brain' } } }),
    ])).toEqual([
      { role: 'user', content: 'improve my website' },
      { role: 'assistant', content: 'Here is the plan.' },
    ]);
  });

  it('labels a specialist agent, which the assistant role cannot disambiguate', () => {
    expect(canvasTranscriptForModel([
      message({ messageRole: 'assistant', body: 'Margins are thin.', metadata: { authoredBy: { kind: 'agent', ref: 'cfo', name: 'CFO' } } }),
    ])).toEqual([{ role: 'assistant', content: 'CFO: Margins are thin.' }]);
  });

  it('drops runtime failure notices so a failed turn cannot become the next turn\'s template', () => {
    expect(canvasTranscriptForModel([
      message({ messageRole: 'user', body: 'connect my email' }),
      message({ messageRole: 'system', body: "I couldn't prepare any canvas changes from that request.", metadata: { error: true } }),
    ])).toEqual([{ role: 'user', content: 'connect my email' }]);
  });
});

describe('stripSpeakerLabel', () => {
  it('removes a copied label, including the compounding form the canvas produced', () => {
    expect(stripSpeakerLabel('Brain: Brain: I could not do it.', ['Brain'])).toBe('I could not do it.');
  });

  it('leaves a real sentence that merely contains a colon alone', () => {
    expect(stripSpeakerLabel('Warning: the dataset is stale.', ['Brain'])).toBe('Warning: the dataset is stale.');
    expect(stripSpeakerLabel('Step 1: install the CLI.', ['Brain'])).toBe('Step 1: install the CLI.');
  });
});

describe('echoesEarlierAnswer', () => {
  const labels = ['Brain'];

  it('catches the measured failure: the reply IS the previous reply, relabelled', () => {
    const conversation = [
      { role: 'user' as const, content: 'improve my website' },
      { role: 'assistant' as const, content: "I couldn't prepare any canvas changes from that request." },
    ];
    expect(echoesEarlierAnswer("Brain: I couldn't prepare any canvas changes from that request.", conversation, labels)).toBe(true);
  });

  it('does not flag a genuinely new answer', () => {
    const conversation = [{ role: 'assistant' as const, content: 'I added a website object.' }];
    expect(echoesEarlierAnswer('I added a campaign plan and three drafts.', conversation, labels)).toBe(false);
  });
});

describe('conversationSpeakerLabels', () => {
  it('collects Brain, the participant, and labels already present in the transcript', () => {
    expect(conversationSpeakerLabels(
      [{ role: 'assistant', content: 'CFO: margins are thin' }],
      ['Growth Specialist'],
    )).toEqual(['Brain', 'Growth Specialist', 'CFO']);
  });
});
