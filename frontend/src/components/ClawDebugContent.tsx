'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { claws } from '@/lib/builderforceApi';
import { ClawGateway } from '@/lib/clawGateway';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--text-secondary)',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: 12,
};

export interface ClawDebugContentProps {
  /** Claw to debug (required). */
  clawId: number;
  /** Display name for the claw. */
  clawName?: string;
  /** Optional className for the root. */
  className?: string;
  /** Optional style for the root. */
  style?: React.CSSProperties;
  /** If true, show a compact header (e.g. when embedded in a panel). Default true. */
  compact?: boolean;
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

export function ClawDebugContent({
  clawId,
  clawName,
  className,
  style,
  compact = true,
}: ClawDebugContentProps) {
  const [connState, setConnState] = useState<'connecting' | 'connected' | 'offline' | 'disconnected'>('disconnected');
  const [statusSnapshot, setStatusSnapshot] = useState<unknown>(null);
  const [healthSnapshot, setHealthSnapshot] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rpcMethod, setRpcMethod] = useState('system-presence');
  const [rpcParams, setRpcParams] = useState('{}');
  const [rpcOutput, setRpcOutput] = useState('');
  const [rpcRunning, setRpcRunning] = useState(false);

  const gatewayRef = useRef<ClawGateway | null>(null);
  const pendingRpcRef = useRef<Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timeout: ReturnType<typeof setTimeout> }>>(new Map());
  const prevConnStateRef = useRef<'connecting' | 'connected' | 'offline' | 'disconnected'>(connState);

  const rejectPending = useCallback((reason: string) => {
    const map = pendingRpcRef.current;
    for (const pending of map.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    map.clear();
  }, []);

  useEffect(() => {
    if (!clawId) return;
    const url = claws.wsUrl(clawId);
    setConnState('connecting');
    setError(null);
    setStatusSnapshot(null);
    setHealthSnapshot(null);

    const gw = new ClawGateway({
      url,
      onEvent: (ev) => {
        if (ev.type === 'connected') {
          setConnState('connected');
          setError(null);
          return;
        }
        if (ev.type === 'claw_online') {
          setConnState('connected');
          return;
        }
        if (ev.type === 'claw_offline') {
          setConnState('offline');
          rejectPending('claw offline');
          return;
        }
        if (ev.type === 'disconnected') {
          setConnState('disconnected');
          rejectPending('gateway disconnected');
          return;
        }
        if (ev.type !== 'message') return;
        const data = ev.data as { type?: string; requestId?: string; result?: unknown; error?: string };
        if (data.type !== 'rpc.result' && data.type !== 'rpc.error') return;
        if (!data.requestId) return;
        const pending = pendingRpcRef.current.get(data.requestId);
        if (!pending) return;
        pendingRpcRef.current.delete(data.requestId);
        clearTimeout(pending.timeout);
        if (data.type === 'rpc.error') {
          pending.reject(new Error(data.error ?? 'RPC failed'));
        } else {
          pending.resolve(data.result);
        }
      },
    });
    gatewayRef.current = gw;

    return () => {
      gw.destroy();
      gatewayRef.current = null;
      rejectPending('gateway closed');
      setConnState('disconnected');
    };
  }, [clawId, rejectPending]);

  const callRpc = useCallback((method: string, params: Record<string, unknown>): Promise<unknown> => {
    const gw = gatewayRef.current;
    if (!gw?.isOpen) return Promise.reject(new Error('No gateway connection'));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRpcRef.current.delete(requestId);
        reject(new Error(`RPC timeout for ${method}`));
      }, 20_000);
      pendingRpcRef.current.set(requestId, { resolve, reject, timeout });
      const sent = gw.send({
        type: 'rpc.call',
        requestId,
        method: method.trim(),
        params,
      });
      if (!sent) {
        clearTimeout(timeout);
        pendingRpcRef.current.delete(requestId);
        reject(new Error('Gateway not connected'));
      }
    });
  }, []);

  const refreshSnapshots = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [status, health] = await Promise.all([
        callRpc('status', {}),
        callRpc('health', {}),
      ]);
      setStatusSnapshot(status);
      setHealthSnapshot(health);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh snapshots');
    } finally {
      setRefreshing(false);
    }
  }, [callRpc]);

  useEffect(() => {
    const justConnected = prevConnStateRef.current !== 'connected' && connState === 'connected';
    prevConnStateRef.current = connState;
    if (justConnected) {
      refreshSnapshots();
    }
  }, [connState, refreshSnapshots]);

  const runManualRpc = useCallback(async () => {
    setRpcRunning(true);
    setError(null);
    setRpcOutput('');
    try {
      const parsed = rpcParams.trim() ? JSON.parse(rpcParams) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Params must be a JSON object');
      }
      const result = await callRpc(rpcMethod, parsed as Record<string, unknown>);
      setRpcOutput(pretty(result));
    } catch (e) {
      setRpcOutput('');
      setError(e instanceof Error ? e.message : 'RPC failed');
    } finally {
      setRpcRunning(false);
    }
  }, [rpcMethod, rpcParams, callRpc]);

  const isOffline = connState === 'offline';
  const dotColor =
    connState === 'connected'
      ? 'var(--surface-success, #22c55e)'
      : connState === 'offline'
        ? 'var(--surface-danger, #ef4444)'
        : 'var(--text-muted)';

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 16, ...style }}>
      {isOffline && (
        <div
          style={{
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 600,
            background: 'rgba(239,68,68,0.2)',
            color: '#fca5a5',
            borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.4)',
          }}
        >
          Claw offline
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            fontSize: 13,
            background: 'rgba(239,68,68,0.15)',
            color: '#ef4444',
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {clawName != null && (
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              {clawName} ({clawId})
            </span>
          )}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dotColor,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{connState}</span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {compact && (
          <>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dotColor,
              }}
              title={connState}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{connState}</span>
          </>
        )}
        <button
          type="button"
          onClick={refreshSnapshots}
          disabled={refreshing || connState !== 'connected'}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: 'var(--surface-interactive)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: refreshing || connState !== 'connected' ? 'not-allowed' : 'pointer',
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh Snapshots'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, alignItems: 'start' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Snapshots</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Status</div>
          <pre style={{ ...preStyle, marginBottom: 12 }}>{pretty(statusSnapshot)}</pre>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Health</div>
          <pre style={preStyle}>{pretty(healthSnapshot)}</pre>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Manual RPC</div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Method
            </label>
            <input
              type="text"
              value={rpcMethod}
              onChange={(e) => setRpcMethod(e.target.value)}
              placeholder="system-presence"
              style={{
                width: '100%',
                padding: '8px 10px',
                fontSize: 13,
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Params (JSON)
            </label>
            <textarea
              value={rpcParams}
              onChange={(e) => setRpcParams(e.target.value)}
              style={{
                width: '100%',
                minHeight: 100,
                padding: '8px 10px',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <button
            type="button"
            onClick={runManualRpc}
            disabled={rpcRunning || connState !== 'connected'}
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--coral-bright)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: rpcRunning || connState !== 'connected' ? 'not-allowed' : 'pointer',
            }}
          >
            {rpcRunning ? 'Calling…' : 'Call'}
          </button>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, marginBottom: 6 }}>Result</div>
          <pre style={{ ...preStyle, maxHeight: 200 }}>{rpcOutput || '(no result)'}</pre>
        </div>
      </div>
    </div>
  );
}
