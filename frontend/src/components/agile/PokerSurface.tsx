'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { pokerApi, isCeremonySessionDone, type PokerSession, type PokerSessionDetail } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';

/**
 * Planning Poker surface. Sessions → stories → votes, with reveal and a final
 * estimate, live over the session WebSocket. Rendered both as the `/embed/poker` view
 * and as the Poker sub-view of the Ceremonies tab.
 *
 * An estimation session is TEAM WORK with an end, so it can be closed here —
 * `poker_sessions.status` used to be written once at insert and never again, so a
 * session the team had finished still read as `active` forever.
 */

const DECK = ['1', '2', '3', '5', '8', '13', '21', '?'];

export function PokerSurface({ initialSessionId }: { initialSessionId?: string | null }) {
  const t = useTranslations('agile');
  const [sessions, setSessions] = useState<PokerSession[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSessionId ?? null);
  const [detail, setDetail] = useState<PokerSessionDetail | null>(null);
  const [name, setName] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // A deep link (a linked chat's "open") names the session — follow it when it changes.
  useEffect(() => { if (initialSessionId) setSelected(initialSessionId); }, [initialSessionId]);

  const loadSessions = useCallback(() => {
    pokerApi.listSessions().then(setSessions).catch(() => setError(t('pokerLoadFailed')));
  }, [t]);
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
    catch { setError(t('createFailedManager')); }
  };

  const addStory = async () => {
    if (!selected || !storyTitle.trim()) return;
    try { await pokerApi.addStory(selected, storyTitle.trim()); setStoryTitle(''); refresh(); }
    catch { setError(t('addStoryFailed')); }
  };

  const vote = (storyId: string, value: string) =>
    pokerApi.vote(storyId, value).then(refresh).catch(() => setError(t('voteFailed')));
  const reveal = (storyId: string) =>
    pokerApi.reveal(storyId).then(refresh).catch(() => setError(t('revealFailed')));
  const estimate = (storyId: string, finalEstimate: string) =>
    pokerApi.patchStory(storyId, { finalEstimate }).then(refresh).catch(() => {});

  /** Close a finished session, or re-open one closed by mistake. Manager-only
   *  server-side; a member's attempt surfaces the same explained failure as a create. */
  const toggleClosed = async () => {
    if (!selected || !detail || closing) return;
    setClosing(true);
    try {
      await pokerApi.setSessionStatus(selected, isCeremonySessionDone(detail.status) ? 'active' : 'completed');
      refresh();
      loadSessions();
    } catch { setError(t('statusFailedManager')); }
    finally { setClosing(false); }
  };

  const statusLabel = (s: string) => t.has(`ceremonyStatus.${s}`) ? t(`ceremonyStatus.${s}`) : s;
  const storyStatusLabel = (s: string) => t.has(`storyStatus.${s}`) ? t(`storyStatus.${s}`) : s;

  if (!selected) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('pokerTitle')}</div>
        {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sessionNamePlaceholder')} aria-label={t('sessionNamePlaceholder')} style={inp} />
          <button onClick={createSession} style={btn}>{t('startSession')}</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelected(s.id)} style={row}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{statusLabel(s.status)}</span>
            </button>
          ))}
          {sessions.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('noSessions')}</div>}
        </div>
      </div>
    );
  }

  const closed = isCeremonySessionDone(detail?.status);

  return (
    <div>
      <button onClick={() => setSelected(null)} style={link}>← {t('sessions')}</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{detail?.name ?? t('loading')}</div>
        {detail && <span style={statusChip}>{statusLabel(detail.status)}</span>}
        {detail && (
          <button onClick={toggleClosed} disabled={closing} style={{ ...secondaryBtn, marginLeft: 'auto' }}>
            {closing ? t('saving') : closed ? t('reopenCeremony') : t('closeCeremony')}
          </button>
        )}
      </div>
      {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}
      {!closed && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <input value={storyTitle} onChange={(e) => setStoryTitle(e.target.value)} placeholder={t('addStoryPlaceholder')} aria-label={t('addStoryPlaceholder')} style={inp} />
          <button onClick={addStory} style={btn}>{t('add')}</button>
        </div>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {detail?.stories.map((story) => {
          const revealed = story.votes.some((v) => v.isRevealed);
          return (
            <div key={story.id} style={card}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{story.title}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{storyStatusLabel(story.status)}{story.finalEstimate ? ` · ${story.finalEstimate}` : ''}</span>
              </div>
              {!closed && (
                <div style={{ display: 'flex', gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
                  {DECK.map((v) => (
                    <button key={v} onClick={() => vote(story.id, v)} aria-label={t('voteValue', { value: v })} style={chip}>{v}</button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('voteCount', { count: story.votes.length })}</span>
                {story.votes.map((v, i) => (
                  <span key={i} style={voteBadge}>{revealed ? (v.value ?? '?') : '•'}</span>
                ))}
                {closed ? null : !revealed
                  ? <button onClick={() => reveal(story.id)} style={{ ...btn, marginLeft: 'auto' }}>{t('reveal')}</button>
                  : (
                    <Select defaultValue={story.finalEstimate ?? ''} aria-label={t('setEstimate')}
                      onChange={(e) => e.target.value && estimate(story.id, e.target.value)}
                      style={{ ...inp, marginLeft: 'auto', maxWidth: 140 }}>
                      <option value="">{t('setEstimate')}</option>
                      {DECK.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                  )}
              </div>
            </div>
          );
        })}
        {detail && detail.stories.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('noStories')}</div>}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { fontSize: 13, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', flex: 1, minWidth: 0 };
const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const statusChip: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };
const link: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 };
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' };
const card: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 14, minWidth: 0 };
const chip: React.CSSProperties = { minWidth: 34, padding: '6px 0', fontSize: 13, fontWeight: 600, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer' };
const voteBadge: React.CSSProperties = { minWidth: 24, textAlign: 'center', padding: '2px 6px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' };
