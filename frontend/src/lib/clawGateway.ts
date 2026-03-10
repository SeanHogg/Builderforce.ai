/**
 * WebSocket gateway client for Builderforce claw relay.
 * Connects to /api/claws/:id/ws (tenant JWT via ?token=).
 * Used by ClawDebugContent for snapshots and manual RPC.
 */

export type GatewayEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; code: number; reason: string }
  | { type: 'claw_offline' }
  | { type: 'claw_online' }
  | { type: 'message'; data: unknown };

export type GatewayEventHandler = (ev: GatewayEvent) => void;

export interface ClawGatewayOptions {
  url: string;
  onEvent: GatewayEventHandler;
}

export class ClawGateway {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: ClawGatewayOptions) {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    this.ws = new WebSocket(this.opts.url);

    this.ws.addEventListener('open', () => {
      this.schedulePings();
      this.opts.onEvent({ type: 'connected' });
    });

    this.ws.addEventListener('message', (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        data = ev.data;
      }
      const msgType =
        data && typeof data === 'object' ? (data as { type?: string }).type : undefined;
      if (msgType === 'claw_offline') {
        this.opts.onEvent({ type: 'claw_offline' });
        return;
      }
      if (msgType === 'claw_online') {
        this.opts.onEvent({ type: 'claw_online' });
        return;
      }
      this.opts.onEvent({ type: 'message', data });
    });

    this.ws.addEventListener('close', (ev) => {
      this.clearPings();
      if (this.destroyed) return;
      this.opts.onEvent({ type: 'disconnected', code: ev.code, reason: ev.reason });
    });

    this.ws.addEventListener('error', () => {
      // close usually follows; no need to duplicate logs
    });
  }

  send(msg: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.clearPings();
    this.ws?.close(1000, 'destroyed');
    this.ws = null;
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private schedulePings(): void {
    this.clearPings();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30_000);
  }

  private clearPings(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
