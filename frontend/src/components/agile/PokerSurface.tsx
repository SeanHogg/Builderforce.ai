'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useState } from 'react';
import { pokerApi, type PokerSession, type PokerSessionDetail } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';

/**
 * Planning Poker embed surface. Sessions → stories → votes, with reveal. The
 * "live" feel comes from polling the session detail every 2s (no WebSocket).
 */

const DECK = ['1', '2', '3', '5', '8', '13', '21', '?'];

export function PokerSurface() {
  const [sessions, setSessions] = useState<PokerSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PokerSessionDetail | null>(null);
  const [name, setName] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    pokerApi.listSessions().then(setSessions).catch(() => setError('Could not load sessions.'));
  }, []);
  useEffect(loadSessions, [loadSessions]);

  const refresh = useCallback(() => {
    if (selected) pokerApi.getSession(selected).then(setDetail).catch(() => {});
  }, [selected]);

  // Initial load on open + live updates pushed over WebSocket (no polling).
  useEffect(() => { if (!selected) setDetail(null); else refresh(); }, [selected, refresh]);
  useRealtimeRoom(selected ? `/api/agile/poker/sessions/${selected}/ws` : null, refresh);

  const createSession = async () => {
    if (!name.trim()) return;
    try { const s = await pokerApi.createSession(name.trim()); setName(''); loadSessions(); setSelected(s.id); }
    catch { setError('Create failed (manager role required).'); }
  };

  const addStory = async () => {
    if (!selected || !storyTitle.trim()) return;
    try { await pokerApi.addStory(selected, storyTitle.trim()); setStoryTitle(''); refresh(); }
    catch { setError('Add story failed.'); }
  };

  const vote = (storyId: string, value: string) =>
    pokerApi.vote(storyId, value).then(refresh).catch(() => setError('Vote failed.'));
  const reveal = (storyId: string) =>
    pokerApi.reveal(storyId).then(refresh).catch(() => setError('Reveal failed.'));
  const estimate = (storyId: string, finalEstimate: string) =>
    pokerApi.patchStory(storyId, { finalEstimate }).then(refresh).catch(() => {});

  if (!selected) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Planning Poker</div>
        {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New session name" style={inp} />
          <button onClick={createSession} style={btn}>Start session</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)} style={row}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{s.status}</span>
            </button>
          ))}
          {sessions.length === 0 && <div style={{ color: '#64748b' }}>No sessions yet.</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setSelected(null)} style={link}>← Sessions</button>
      <div style={{ fontSize: 16, fontWeight: 600, margin: '8px 0' }}>{detail?.name ?? 'Loading…'}</div>
      {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={storyTitle} onChange={(e) => setStoryTitle(e.target.value)} placeholder="Add a story" style={inp} />
        <button onClick={addStory} style={btn}>Add</button>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {detail?.stories.map((story) => {
          const revealed = story.votes.some((v) => v.isRevealed);
          return (
            <div key={story.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{story.title}</span>
                <span style={{ fontSize: 12, color: '#64748b' }}>{story.status}{story.finalEstimate ? ` · ${story.finalEstimate}` : ''}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
                {DECK.map((v) => <button key={v} onClick={() => vote(story.id, v)} style={chip}>{v}</button>)}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>{story.votes.length} vote(s):</span>
                {story.votes.map((v, i) => (
                  <span key={i} style={voteBadge}>{revealed ? (v.value ?? '?') : '•'}</span>
                ))}
                {!revealed
                  ? <button onClick={() => reveal(story.id)} style={{ ...btn, marginLeft: 'auto' }}>Reveal</button>
                  : (
                    <Select defaultValue={story.finalEstimate ?? ''} onChange={(e) => e.target.value && estimate(story.id, e.target.value)} style={{ ...inp, marginLeft: 'auto', maxWidth: 140 }}>
                      <option value="">Set estimate…</option>
                      {DECK.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  )}
              </div>
            </div>
          );
        })}
        {detail && detail.stories.length === 0 && <div style={{ color: '#64748b' }}>No stories yet.</div>}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-subtle, #e2e8f0)', background: 'var(--bg-base, #fff)', flex: 1 };
const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const link: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 13, padding: 0 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 8, background: 'var(--bg-base, #fff)', cursor: 'pointer', textAlign: 'left' };
const card: React.CSSProperties = { border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 8, padding: 14 };
const chip: React.CSSProperties = { minWidth: 34, padding: '6px 0', fontSize: 13, fontWeight: 600, border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 6, background: 'var(--bg-elevated, #f8fafc)', cursor: 'pointer' };
const voteBadge: React.CSSProperties = { minWidth: 24, textAlign: 'center', padding: '2px 6px', fontSize: 12, fontWeight: 600, borderRadius: 6, background: 'var(--bg-elevated, #f1f5f9)' };
