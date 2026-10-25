/**
 * One connected account: its name, how it is connected, what the last call said about it,
 * and the two things a person can do from the chat — Test it, and (for a subscription)
 * Reconnect it, finishing the sign-in in place.
 */
import { useState } from 'react';
import { fill } from '../spend/format';
import { healthLabel, type ComposerConnections, type ConnectionsLabels, type ProviderConnection } from './types';
import { useProviderReconnect, type ReconnectFailure } from './useProviderReconnect';

export interface ConnectionRowProps {
  row: ProviderConnection;
  connections: ComposerConnections;
  labels: ConnectionsLabels;
  onChanged: (change: Partial<ProviderConnection>) => void;
  onReconnected: () => void;
}

function failureText(failure: ReconnectFailure, labels: ConnectionsLabels): string {
  switch (failure.reason) {
    case 'denied': return labels.errDenied;
    case 'expired': return labels.errExpired;
    case 'unavailable': return failure.detail ? `${labels.errStart} ${failure.detail}` : labels.errStart;
    default: return failure.detail ? `${labels.errFailed} ${failure.detail}` : labels.errFailed;
  }
}

export function ConnectionRow({ row, connections, labels, onChanged, onReconnected }: ConnectionRowProps) {
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const reconnect = useProviderReconnect(connections.client, row.provider, {
    openUrl: connections.openUrl,
    onConnected: () => {
      setNote({ ok: true, text: labels.reconnected });
      onReconnected();
    },
  });

  const test = async () => {
    setTesting(true);
    setNote(null);
    try {
      const result = await connections.client.test(row.provider);
      if (result.health) onChanged({ health: result.health });
      setNote(result.ok ? { ok: true, text: labels.testOk } : { ok: false, text: result.message ?? labels.errFailed });
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : labels.errFailed });
    } finally {
      setTesting(false);
    }
  };

  const busy = testing || reconnect.phase === 'starting' || reconnect.phase === 'finishing';
  const healthy = row.health === 'ok';

  return (
    <div className="bf-conn__row">
      <div className="bf-conn__head">
        <span className={`bf-conn__dot${healthy ? ' is-ok' : row.health === 'capacity' ? ' is-warn' : ' is-bad'}`} aria-hidden="true" />
        <span className="bf-conn__name">{row.label}</span>
        <span className="bf-conn__kind">{row.authType === 'oauth' ? labels.authOauth : labels.authApiKey}</span>
      </div>
      <div className={`bf-conn__health${healthy ? '' : ' is-alert'}`} role="status">{healthLabel(row.health, labels)}</div>

      {reconnect.phase === 'paste' || reconnect.phase === 'finishing' ? (
        <div className="bf-conn__flow">
          <span className="bf-pmenu__desc">{labels.pasteHint}</span>
          <div className="bf-conn__actions">
            <input
              className="bf-pmenu__search bf-conn__input"
              value={reconnect.code}
              onChange={(e) => reconnect.setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void reconnect.finish(); } }}
              placeholder={labels.pastePlaceholder}
              aria-label={labels.pastePlaceholder}
              disabled={reconnect.phase === 'finishing'}
              autoFocus
            />
            <button type="button" className="bf-conn__btn is-primary" disabled={busy || !reconnect.code.trim()} onClick={() => void reconnect.finish()}>
              {reconnect.phase === 'finishing' ? labels.finishing : labels.finish}
            </button>
            <button type="button" className="bf-conn__btn" disabled={reconnect.phase === 'finishing'} onClick={reconnect.cancel}>
              {labels.cancel}
            </button>
          </div>
        </div>
      ) : reconnect.phase === 'device' ? (
        <div className="bf-conn__flow">
          <span className="bf-pmenu__desc">{fill(labels.deviceHint, { code: reconnect.userCode ?? '…' })}</span>
          <div className="bf-conn__actions">
            <button type="button" className="bf-conn__btn" onClick={reconnect.cancel}>{labels.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="bf-conn__actions">
          <button type="button" className="bf-conn__btn" disabled={busy} onClick={() => void test()}>
            {testing ? labels.testing : labels.test}
          </button>
          {row.reconnectable && (
            <button
              type="button"
              className={`bf-conn__btn${healthy || row.health === 'capacity' ? '' : ' is-primary'}`}
              disabled={busy}
              onClick={() => { setNote(null); void reconnect.start(); }}
            >
              {labels.reconnect}
            </button>
          )}
        </div>
      )}

      {reconnect.failure && <div className="bf-conn__note is-bad" role="alert">{failureText(reconnect.failure, labels)}</div>}
      {!reconnect.failure && note && <div className={`bf-conn__note${note.ok ? ' is-ok' : ' is-bad'}`} role="status">{note.text}</div>}
    </div>
  );
}
