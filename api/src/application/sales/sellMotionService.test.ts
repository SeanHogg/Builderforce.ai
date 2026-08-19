import { describe, expect, it } from 'vitest';
import { talkRatioPercent } from './sellMotionService';
import { readShareSettings, SHAREABLE_CANVAS_KINDS } from './prospectShare';

/**
 * The two pure decisions in the sell motion that are easy to get plausibly wrong.
 *
 * A talk ratio that confidently reports 50% for a transcript with no speaker labels, and a
 * share that renders an attacker-supplied string into a `style` attribute on a page served
 * to a stranger. Both are silent; both get a test.
 */
describe('talk ratio', () => {
  const transcript = [
    'Sam: So tell me about the rollout, what does that look like on your side',
    'Priya: We would need it live before the quarter closes',
    'Sam: Understood',
  ].join('\n');

  it('splits by whose side each speaker is on', () => {
    // Priya is the counterparty; Sam is us. 15 words of ours, 9 of theirs.
    expect(talkRatioPercent(transcript, 'Priya')).toBe(Math.round((15 / 24) * 100));
  });

  it('handles several people on their side', () => {
    const two = `${transcript}\nJordan: And security review takes two weeks`;
    expect(talkRatioPercent(two, 'Priya and Jordan')).toBeLessThan(talkRatioPercent(two, 'Priya'));
  });

  it('refuses rather than reporting a confident 50%', () => {
    // No `Speaker:` labels at all — an unlabelled transcript carries no ratio, and
    // inventing one would put a fabricated coaching number in front of a rep.
    expect(talkRatioPercent('we talked about the rollout for a while', 'Priya')).toBeUndefined();
    expect(talkRatioPercent('', 'Priya')).toBeUndefined();
  });

  it('counts an unnamed counterparty as entirely us, rather than crashing', () => {
    expect(talkRatioPercent(transcript, '')).toBe(100);
  });
});

describe('prospect share settings', () => {
  it('drops anything that is not a colour', () => {
    // This value reaches a `style` attribute on a page served to somebody with no account.
    expect(readShareSettings({ accentColor: '#4f46e5' }).accentColor).toBe('#4f46e5');
    expect(readShareSettings({ accentColor: 'red; background:url(x)' }).accentColor).toBe('');
    expect(readShareSettings({ accentColor: 'javascript:alert(1)' }).accentColor).toBe('');
    expect(readShareSettings({ accentColor: 'rgb(1,2,3)' }).accentColor).toBe('');
  });

  it('defaults control-request to OFF', () => {
    // Watch-only unless the seller said otherwise: a prospect who can drive the board
    // mid-demo is a demo that goes wrong in front of a buyer.
    expect(readShareSettings({}).allowControlRequest).toBe(false);
    expect(readShareSettings({ allowControlRequest: 'yes' }).allowControlRequest).toBe(false);
    expect(readShareSettings({ allowControlRequest: true }).allowControlRequest).toBe(true);
  });

  it('renders a share minted before a setting existed', () => {
    expect(readShareSettings(null)).toEqual({
      sellerName: '', sellerCompany: '', accentColor: '', allowControlRequest: false, message: '',
    });
  });
});

describe('what may be handed to a buyer', () => {
  it('allows the commercial artifacts and nothing internal', () => {
    for (const kind of ['quote', 'trustPacket', 'mutualActionPlan', 'call', 'trial', 'prototype', 'slides', 'website']) {
      expect(SHAREABLE_CANVAS_KINDS.has(kind), kind).toBe(true);
    }
    // The control is that the tool REFUSES, not that the seller chooses well.
    for (const kind of ['capTable', 'dispatchBoard', 'candidate', 'budget', 'salesPipeline', 'legalDocument']) {
      expect(SHAREABLE_CANVAS_KINDS.has(kind), kind).toBe(false);
    }
  });
});
