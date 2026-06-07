'use client';

import { useEffect, useRef, useState } from 'react';
import { runtimeApi, type Execution } from '@/lib/builderforceApi';

/**
 * Live event stream for a single execution. Subscribes to the runtime WebSocket
 * (`/executions/:id/stream`) and falls back to REST polling when the socket is
 * unavailable, so an execution updates in real time without the caller waiting
 * on the agent. Accumulates the assistant/user message thread and the set of
 * files the agent touched, which back the Output / Changes views.
 */

export interface ExecutionMessage {
  role: 'user' | 'assistant';
  text: string;
  ts: string;
}

export interface ExecutionFileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted';
  ts: string;
}

export interface ExecutionStreamState {
  status: string | null;
  execution: Execution | null;
  messages: ExecutionMessage[];
  fileChanges: ExecutionFileChange[];
  /** True while a live WebSocket is connected (vs polling fallback). */
  connected: boolean;
}

type StreamEvent =
  | { type: 'status_change' | 'done'; status: string; execution: Execution }
  | { type: 'message'; role: 'user' | 'assistant'; text: string; ts: string }
  | { type: 'file_change'; path: string; change: ExecutionFileChange['change']; ts: string }
  | { type: 'error'; message: string };

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

export function useExecutionStream(executionId: number | null): ExecutionStreamState {
  const [status, setStatus] = useState<string | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [messages, setMessages] = useState<ExecutionMessage[]>([]);
  const [fileChanges, setFileChanges] = useState<ExecutionFileChange[]>([]);
  const [connected, setConnected] = useState(false);

  // Allow callers to inject optimistic user messages without a round-trip; keep
  // a ref to the latest setters used by the effect's cleanup.
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setStatus(null);
    setExecution(null);
    setMessages([]);
    setFileChanges([]);
    setConnected(false);

    if (executionId == null) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyEvent = (evt: StreamEvent) => {
      if (cancelled) return;
      if (evt.type === 'status_change' || evt.type === 'done') {
        setStatus(evt.status);
        setExecution(evt.execution);
      } else if (evt.type === 'message') {
        setMessages((prev) => [...prev, { role: evt.role, text: evt.text, ts: evt.ts }]);
      } else if (evt.type === 'file_change') {
        setFileChanges((prev) => {
          const next = prev.filter((f) => f.path !== evt.path);
          next.push({ path: evt.path, change: evt.change, ts: evt.ts });
          return next;
        });
      }
    };

    const startPolling = () => {
      if (pollTimer || cancelled) return;
      const tick = async () => {
        try {
          const exec = await runtimeApi.get(executionId);
          if (cancelled) return;
          setExecution(exec);
          setStatus(exec.status);
          if (TERMINAL.has(exec.status) && pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        } catch { /* keep polling; transient */ }
      };
      void tick();
      pollTimer = setInterval(tick, 3000);
    };

    const url = runtimeApi.streamUrl(executionId);
    if (!url || typeof WebSocket === 'undefined') {
      startPolling();
      return () => { cancelled = true; if (pollTimer) clearInterval(pollTimer); };
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      startPolling();
      return () => { cancelled = true; if (pollTimer) clearInterval(pollTimer); };
    }
    wsRef.current = ws;

    ws.onopen = () => { if (!cancelled) setConnected(true); };
    ws.onmessage = (e) => {
      try { applyEvent(JSON.parse(e.data as string) as StreamEvent); } catch { /* ignore malformed */ }
    };
    ws.onerror = () => { if (!cancelled) { setConnected(false); startPolling(); } };
    ws.onclose = () => {
      if (cancelled) return;
      setConnected(false);
      // If the run hasn't terminated, fall back to polling to keep it live.
      setStatus((s) => { if (!s || !TERMINAL.has(s)) startPolling(); return s; });
    };

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      wsRef.current = null;
      try { ws.close(); } catch { /* already closed */ }
    };
  }, [executionId]);

  return { status, execution, messages, fileChanges, connected };
}
