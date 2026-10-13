import { afterEach, describe, expect, it } from 'vitest';
import { VISIT_IDLE_MS, VISITOR_ID_PATTERN } from '@builderforce/interaction-contract';
import { idNamespace, mintId, resolveIdentity, storageKeys } from './ids';
import { VisitStore } from './visitState';

afterEach(() => {
  window.localStorage.clear();
  document.cookie.split(';').forEach((part) => {
    const name = part.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; max-age=0; path=/`;
  });
});

describe('idNamespace', () => {
  it('shares bf_* on builderforce.ai and its subdomains, bfr_* elsewhere', () => {
    expect(idNamespace('builderforce.ai')).toBe('bf');
    expect(idNamespace('app.builderforce.ai')).toBe('bf');
    expect(idNamespace('shop.example.com')).toBe('bfr');
    expect(idNamespace('notbuilderforce.ai')).toBe('bfr');
    expect(storageKeys('bf')).toMatchObject({ visitor: 'bf_visitor_id', visit: 'bf_visit_id' });
    expect(storageKeys('bfr')).toMatchObject({ visitor: 'bfr_visitor_id', visit: 'bfr_visit_id' });
  });
});

describe('mintId', () => {
  it('matches the ingest guard', () => {
    for (let i = 0; i < 20; i++) expect(mintId()).toMatch(VISITOR_ID_PATTERN);
  });
});

describe('resolveIdentity', () => {
  it('mints a visitor once and reports it as new only then', () => {
    const first = resolveIdentity('bfr', 1_000);
    expect(first.newVisitor).toBe(true);
    expect(window.localStorage.getItem('bfr_visitor_id')).toBe(first.visitorId);
    expect(window.localStorage.getItem('bf_visitor_id')).toBeNull();
    const second = resolveIdentity('bfr', 2_000);
    expect(second.newVisitor).toBe(false);
    expect(second.visitorId).toBe(first.visitorId);
  });

  it('keeps the visit inside the idle gap and rotates after it', () => {
    const t0 = 1_700_000_000_000;
    const first = resolveIdentity('bfr', t0).visitId;
    const seen = t0 + VISIT_IDLE_MS;
    expect(resolveIdentity('bfr', seen).visitId).toBe(first);
    expect(resolveIdentity('bfr', seen + VISIT_IDLE_MS + 1).visitId).not.toBe(first);
  });

  it('reuses the product visit on builderforce.ai', () => {
    window.localStorage.setItem('bf_visit_id', 'productVisit123');
    window.localStorage.setItem('bf_visit_last_seen', String(5_000));
    expect(resolveIdentity('bf', 6_000).visitId).toBe('productVisit123');
  });
});

describe('VisitStore', () => {
  it('continues seq across page loads of the same visit and resets for a new one', () => {
    const a = new VisitStore('bfr_replay_state', 'visitAAAA1', 100);
    expect(a.nextSeq()).toBe(0);
    expect(a.nextSeq()).toBe(1);
    const reload = new VisitStore('bfr_replay_state', 'visitAAAA1', 900);
    expect(reload.state.startedAt).toBe(100);
    expect(reload.nextSeq()).toBe(2);
    const next = new VisitStore('bfr_replay_state', 'visitBBBB2', 5_000);
    expect(next.nextSeq()).toBe(0);
    expect(next.state.startedAt).toBe(5_000);
  });
});
