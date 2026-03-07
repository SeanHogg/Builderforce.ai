export class CollaborationRoom implements DurableObject {
  private sessions: Map<WebSocket, { userId: string; name: string; color: string }> = new Map();
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    const userId = url.searchParams.get('userId') || `user-${Date.now()}`;
    const name = url.searchParams.get('name') || `User ${userId.slice(0, 6)}`;
    const color = url.searchParams.get('color') || '#4f46e5';

    this.sessions.set(server, { userId, name, color });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      const session = this.sessions.get(ws);
      if (!session) return;

      if (typeof message !== 'string') {
        // Binary Yjs update - broadcast to all others
        this.broadcast(ws, message);
        return;
      }

      const data = JSON.parse(message) as { type: string; [key: string]: unknown };

      switch (data.type) {
        case 'yjs-update':
          this.broadcast(ws, message);
          break;
        case 'presence':
          this.broadcast(ws, JSON.stringify({
            ...data,
            type: 'presence',
            userId: session.userId,
            name: session.name,
            color: session.color,
          }));
          break;
        case 'terminal-input':
          this.broadcast(ws, JSON.stringify({
            type: 'terminal-input',
            userId: session.userId,
            data: data.data,
          }));
          break;
        case 'terminal-output':
          this.broadcast(ws, JSON.stringify({
            type: 'terminal-output',
            data: data.data,
          }));
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.sessions.delete(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.sessions.delete(ws);
  }

  private broadcast(sender: WebSocket, message: string | ArrayBuffer): void {
    for (const [ws] of this.sessions) {
      if (ws !== sender && ws.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          ws.send(message);
        } catch {
          this.sessions.delete(ws);
        }
      }
    }
  }
}
