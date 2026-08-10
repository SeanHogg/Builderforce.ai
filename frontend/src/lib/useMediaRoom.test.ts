import { describe, expect, it } from 'vitest';
import { selectedMediaPath } from './useMediaRoom';

function stats(rows: Array<Record<string, unknown>>): RTCStatsReport {
  const map = new Map(rows.map((row) => [String(row.id), row]));
  return map as unknown as RTCStatsReport;
}

describe('selectedMediaPath', () => {
  it('reports a direct selected ICE pair', () => {
    const result = selectedMediaPath(stats([
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'pair' },
      { id: 'pair', type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' },
      { id: 'local', type: 'local-candidate', candidateType: 'host', protocol: 'udp' },
      { id: 'remote', type: 'remote-candidate', candidateType: 'srflx' },
    ]), 'peer-1');
    expect(result).toMatchObject({ peerId: 'peer-1', localCandidateType: 'host', remoteCandidateType: 'srflx', protocol: 'udp', relayed: false });
  });

  it('discloses when the selected path uses TURN relay', () => {
    const result = selectedMediaPath(stats([
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, localCandidateId: 'local', remoteCandidateId: 'remote' },
      { id: 'local', candidateType: 'relay' }, { id: 'remote', candidateType: 'srflx' },
    ]), 'peer-2');
    expect(result?.relayed).toBe(true);
  });
});
