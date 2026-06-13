'use client';

import { useEffect, useRef, useState } from 'react';
import type { CeremonySession, CeremonyParticipant } from '@/lib/builderforceApi';
import { formatDuration } from '@/lib/duration';

const btn = (variant: 'primary' | 'tertiary'): React.CSSProperties => ({
  padding: '6px 12px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 8,
  cursor: 'pointer',
  border: variant === 'primary' ? 'none' : '1px solid var(--border-subtle)',
  background: variant === 'primary' ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-deep)',
  color: variant === 'primary' ? '#fff' : 'var(--text-secondary)',
});

/**
 * Standup lifecycle header: Start (no active session) → live total + current
 * speaker + per-turn timer → Next / Complete. In `timeboxed` mode shows a
 * countdown and the facilitator's client auto-advances at expiry. Non-facilitators
 * see the same live read-out (no controls). Owns a 1s tick for the timers.
 */
export function StandupControls({
  session,
  participants,
  isFacilitator,
  busy,
  onStart,
  onNext,
  onComplete,
}: {
  session: CeremonySession | null;
  participants: CeremonyParticipant[];
  isFacilitator: boolean;
  busy: boolean;
  onStart: () => void;
  onNext: (nextTurn: number) => void;
  onComplete: () => void;
}) {
  const [, setTick] = useState(0);
  const autoFiredFor = useRef<string>('');

  const active = session?.status === 'active';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!session || session.status !== 'active') {
    return (
      <button type="button" style={btn('primary')} disabled={busy || !isFacilitator} onClick={onStart}
        title={isFacilitator ? 'Start the standup' : 'Only the facilitator can start'}>
        Start standup
      </button>
    );
  }

  const now = Date.now();
  const totalMs = now - new Date(session.startedAt).getTime();
  const turn = session.currentTurn ?? 0;
  const speaker = participants.find((p) => p.turnOrder === turn) ?? participants[turn];
  const turnMs = session.turnStartedAt ? now - new Date(session.turnStartedAt).getTime() : 0;
  const isLast = turn >= participants.length - 1;

  // Timebox auto-advance (facilitator only; once per turn).
  const remainingMs = session.turnMode === 'timeboxed' ? session.turnSeconds * 1000 - turnMs : null;
  if (isFacilitator && !busy && remainingMs != null && remainingMs <= 0) {
    const fireKey = `${session.id}:${turn}`;
    if (autoFiredFor.current !== fireKey) {
      autoFiredFor.current = fireKey;
      if (isLast) onComplete(); else onNext(turn + 1);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
        {formatDuration(totalMs)}
      </span>
      {speaker && (
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          🎤 <strong style={{ color: 'var(--text-primary)' }}>{speaker.memberName}</strong>
          <span style={{ marginLeft: 6, fontFamily: 'var(--font-mono)', color: remainingMs != null && remainingMs <= 10000 ? 'var(--error)' : 'var(--text-muted)' }}>
            {remainingMs != null ? formatDuration(Math.max(0, remainingMs)) : formatDuration(turnMs)}
          </span>
        </span>
      )}
      {isFacilitator && (
        <>
          {!isLast && (
            <button type="button" style={btn('tertiary')} disabled={busy} onClick={() => onNext(turn + 1)}>
              Next →
            </button>
          )}
          <button type="button" style={btn('primary')} disabled={busy} onClick={onComplete}>
            Complete
          </button>
        </>
      )}
    </div>
  );
}
