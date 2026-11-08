/** Only the dispatch/admission path may say where a run landed: server-stamped keys never ride in on a payload. */
import { describe, expect, it } from 'vitest';
import { buildFollowUpPayload, stripAdmissionStamps } from './cloudDispatch';

describe('stripAdmissionStamps', () => {
  it('regression: drops a client-supplied executor and admission stamp, keeps everything else', () => {
    const out = JSON.parse(stripAdmissionStamps(JSON.stringify({ executor: 'durable', cloud_admitted_seq: 3, cloudAdmittedSeq: 4, model: 'm' }))!);
    expect(out).toEqual({ model: 'm' });
  });

  it('returns the payload untouched when there is nothing to strip, or it is not an object', () => {
    expect(stripAdmissionStamps(undefined)).toBeUndefined();
    expect(stripAdmissionStamps('not json')).toBe('not json');
    expect(stripAdmissionStamps('{"model":"m"}')).toBe('{"model":"m"}');
  });
});

describe('buildFollowUpPayload', () => {
  it('regression: a follow-up does not inherit where the prior run landed', () => {
    const out = JSON.parse(buildFollowUpPayload(JSON.stringify({ executor: 'github_actions', cloud_admitted_seq: 9, model: 'm' }), { directive: 'd', priorExecutionId: 1 }));
    expect(out.executor).toBeUndefined();
    expect(out.cloud_admitted_seq).toBeUndefined();
    expect(out.model).toBe('m');
  });
});
