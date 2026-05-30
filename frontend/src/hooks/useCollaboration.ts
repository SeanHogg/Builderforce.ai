'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * The collab WS lives in the separate `worker/` deployment (CollaborationRoom
 * Durable Object), NOT the api worker. Without a dedicated endpoint, y-websocket
 * defaulted to `${NEXT_PUBLIC_WORKER_URL}/api/collab` → fell back to the api
 * worker URL (no collab route) → connection refused → reconnect loop with no
 * backoff → infinite console spam.
 *
 * Make collab opt-in: set NEXT_PUBLIC_COLLAB_WS_URL to the collab endpoint
 * (e.g. wss://collab.builderforce.ai). When unset, the hook is inert — no WS
 * attempted, no spam, no silent failure mode.
 */
function getCollabWsUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_COLLAB_WS_URL;
  if (explicit && explicit.trim()) return explicit.replace(/\/+$/, '');
  return null;
}

export function useCollaboration(projectId: string | number, userId: string) {
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const roomId = String(projectId);

  useEffect(() => {
    if (!roomId || !userId) return;
    const wsBase = getCollabWsUrl();
    if (!wsBase) {
      // Collab not configured for this environment — log once, do nothing.
      // eslint-disable-next-line no-console
      console.info(
        '[builderforce] Real-time collaboration disabled: set NEXT_PUBLIC_COLLAB_WS_URL to enable.',
      );
      return;
    }

    const doc = new Y.Doc();
    docRef.current = doc;

    const provider = new WebsocketProvider(wsBase, roomId, doc, { connect: true });
    providerRef.current = provider;

    provider.on('status', ({ status }: { status: string }) => {
      setConnected(status === 'connected');
    });

    provider.awareness.setLocalState({
      userId,
      name: `User ${userId.slice(0, 6)}`,
      color: `#${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0')}`,
    });

    return () => {
      provider.destroy();
      doc.destroy();
      docRef.current = null;
      providerRef.current = null;
      setConnected(false);
    };
  }, [roomId, userId]);

  // eslint-disable-next-line react-hooks/refs
  return { doc: docRef.current, provider: providerRef.current, connected };
}
