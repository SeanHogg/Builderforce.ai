'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

export function useCollaboration(projectId: string | number, userId: string) {
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const roomId = String(projectId);

  useEffect(() => {
    if (!roomId || !userId) return;

    const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';
    const wsUrl = workerUrl.replace(/^http/, 'ws');

    const doc = new Y.Doc();
    docRef.current = doc;

    const provider = new WebsocketProvider(
      `${wsUrl}/api/collab`,
      roomId,
      doc,
      { connect: true }
    );
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
