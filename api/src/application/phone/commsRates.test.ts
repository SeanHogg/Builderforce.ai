/**
 * The metering rules — the ones that decide what somebody is billed.
 *
 * Segment counting is the case worth the most tests: it is the only place where a
 * plausible-looking implementation (`length / 160`) under-bills exactly the
 * messages that cost the most, and the failure is invisible until a carrier
 * invoice arrives.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_COMMS_RATES, rateFor, smsSegments, voiceMinutes } from './commsRates';

describe('SMS segments', () => {
  it('bills an empty body as one segment, because the carrier does', () => {
    expect(smsSegments('')).toBe(1);
  });

  it('fits 160 GSM-7 characters in one segment and 161 in two', () => {
    expect(smsSegments('a'.repeat(160))).toBe(1);
    expect(smsSegments('a'.repeat(161))).toBe(2);
  });

  it('drops to 153 per segment once concatenated', () => {
    // 306 = 2 × 153 exactly; 307 needs a third.
    expect(smsSegments('a'.repeat(306))).toBe(2);
    expect(smsSegments('a'.repeat(307))).toBe(3);
  });

  it('ONE emoji takes a 90-character message from one segment to two', () => {
    // The whole reason this function exists. `length / 160` says one.
    const body = `${'a'.repeat(89)}🙂`;
    expect(smsSegments('a'.repeat(90))).toBe(1);
    expect(smsSegments(body)).toBe(2);
  });

  it('uses the UCS-2 budget for any non-GSM-7 body', () => {
    // € IS in the GSM-7 extension, so 70 characters is still well inside one
    // 160-character segment. 中 is not, which drops the whole body to the 70-unit
    // UCS-2 budget — 70 units still fits, 71 does not.
    expect(smsSegments(`${'a'.repeat(69)}€`)).toBe(1);
    expect(smsSegments(`${'a'.repeat(69)}中`)).toBe(1);
    expect(smsSegments(`${'a'.repeat(70)}中`)).toBe(2);
    expect(smsSegments('中'.repeat(70))).toBe(1);
    expect(smsSegments('中'.repeat(71))).toBe(2);
  });

  it('accepts accented Latin that is genuinely in GSM-7', () => {
    expect(smsSegments(`${'a'.repeat(155)}éàäöñü`)).toBe(2);
    expect(smsSegments('é'.repeat(160))).toBe(1);
  });
});

describe('voice minutes', () => {
  it('bills a started minute', () => {
    expect(voiceMinutes(1)).toBe(1);
    expect(voiceMinutes(60)).toBe(1);
    expect(voiceMinutes(61)).toBe(2);
    expect(voiceMinutes(600)).toBe(10);
  });

  it('never bills zero for a connected call', () => {
    expect(voiceMinutes(0)).toBe(1);
  });
});

describe('rate card', () => {
  it('prices every unit it declares', () => {
    for (const rate of DEFAULT_COMMS_RATES) {
      expect(rateFor(rate.unit), rate.unit).toBe(rate.cents);
    }
  });

  it('lets a tenant override one unit without disturbing the others', () => {
    const override = { sms_segment: 7 } as const;
    expect(rateFor('sms_segment', override)).toBe(7);
    expect(rateFor('voice_minute', override)).toBe(rateFor('voice_minute'));
  });

  it('honours a zero override — free is a legitimate price', () => {
    expect(rateFor('sms_segment', { sms_segment: 0 })).toBe(0);
  });

  it('ignores a negative override rather than paying somebody to send', () => {
    expect(rateFor('sms_segment', { sms_segment: -5 })).toBe(rateFor('sms_segment'));
  });
});
