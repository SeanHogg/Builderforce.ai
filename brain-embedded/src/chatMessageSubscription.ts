/**
 * Shared reconnecting WebSocket invalidation client for Brain chat messages.
 * Both BuilderForce web and VSIX adapters use this implementation so auth,
 * reconnect, cleanup, and frame handling cannot drift between surfaces.
 */
export function subscribeToChatMessages(
  baseUrl: string,
  getToken: () => string | null,
  chatId: number,
  onChanged: () => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const connect = () => {
    if (stopped || typeof WebSocket === 'undefined') return;
    const token = getToken();
    if (!token) return;
    const url = new URL(`/api/brain/chats/${chatId}/stream`, baseUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token);
    try {
      socket = new WebSocket(url.toString());
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => { attempt = 0; };
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as { type?: string };
        if (frame.type === 'changed') onChanged();
      } catch { /* ignore non-protocol frames */ }
    };
    socket.onclose = () => scheduleReconnect();
    socket.onerror = () => socket?.close();
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    const delay = Math.min(1_000 * 2 ** attempt++, 30_000);
    retry = setTimeout(() => { retry = null; connect(); }, delay);
  };

  connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
    socket = null;
  };
}
