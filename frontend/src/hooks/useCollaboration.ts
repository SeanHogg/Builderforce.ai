'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import {
  collabColorFor,
  collabParams,
  collabRoom,
  collabSocketBase,
} from '@/domains/collab/infrastructure/collabTransport';

/**
 * An IDE project's shared buffer.
 *
 * The room used to be unreachable: it pointed at a second Worker script that has
 * never been deployed, behind an `NEXT_PUBLIC_COLLAB_WS_URL` nobody sets, and the
 * hook logged "collaboration disabled" and returned. The room is part of the api
 * Worker now and the URL is derived from the API origin — see
 * `domains/collab/infrastructure/collabTransport.ts`.
 *
 * The server admits `project:<id>` only for a project in the caller's workspace,
 * so a room name is no longer a bare integer anyone could guess into.
 */
export function useCollaboration(projectId: string | number, userId: string) {
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const roomId = String(projectId);

  useEffect(() => {
    if (!roomId || !userId) return;
    const wsBase = collabSocketBase();
    const params = collabParams({ name: `User ${userId.slice(0, 6)}`, color: collabColorFor(userId) });
    // No API origin, or no session yet — an upgrade would 401 into a reconnect
    // loop, so stay inert. Editing continues locally.
    if (!wsBase || !params) return;

    const doc = new Y.Doc();
    docRef.current = doc;

    const provider = new WebsocketProvider(wsBase, collabRoom('project', roomId), doc, { connect: true, params });
    providerRef.current = provider;

    provider.on('status', ({ status }: { status: string }) => {
      setConnected(status === 'connected');
    });

    provider.awareness.setLocalState({
      userId,
      name: `User ${userId.slice(0, 6)}`,
      color: collabColorFor(userId),
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
