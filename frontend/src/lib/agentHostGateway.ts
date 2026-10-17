/**
 * WebSocket gateway client for Builderforce agentHost relay.
 * Connects to /api/agent-hosts/:id/ws (tenant JWT via ?token=).
 * Used by AgentHostDebugContent for snapshots and manual RPC.
 */
import { createReconnector, openSocket, type Reconnector } from './polling/reconnectPolicy';

export type GatewayEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; code: number; reason: string }
  /** A reconnect attempt is starting (only with `reconnect: true`). */
  | { type: 'reconnecting' }
  | { type: 'agent_host_offline' }
  | { type: 'agent_host_online' }
  | { type: 'message'; data: unknown };

export type GatewayEventHandler = (ev: GatewayEvent) => void;

export interface AgentHostGatewayOptions {
  url: string;
  onEvent: GatewayEventHandler;
  /**
   * Reconnect after a drop, under the shared reconnect policy (backoff, auth close
   * codes, no retry while the tab is hidden). Off by default: a debug view that
   * shows "disconnected" is telling the truth.
   */
  reconnect?: boolean;
}

export class AgentHostGateway {
  private ws: WebSocket | null = null;
  private destroyed = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private readonly reconnector: Reconnector | null;
  private attempted = false;

  constructor(private opts: AgentHostGatewayOptions) {
    this.reconnector = opts.reconnect ? createReconnector({ connect: () => this.connect() }) : null;
    if (this.reconnector) this.reconnector.start();
    else this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    if (this.attempted) this.opts.onEvent({ type: 'reconnecting' });
    this.attempted = true;
    this.ws = openSocket(this.opts.url);
    if (!this.ws) { this.reconnector?.closed(); return; }

    this.ws.addEventListener('open', () => {
      this.reconnector?.opened();
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
      if (msgType === 'agent_host_offline') {
        this.opts.onEvent({ type: 'agent_host_offline' });
        return;
      }
      if (msgType === 'agent_host_online') {
        this.opts.onEvent({ type: 'agent_host_online' });
        return;
      }
      this.opts.onEvent({ type: 'message', data });
    });

    this.ws.addEventListener('close', (ev) => {
      this.clearPings();
      if (this.destroyed) return;
      this.opts.onEvent({ type: 'disconnected', code: ev.code, reason: ev.reason });
      this.reconnector?.closed(ev.code);
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
    this.reconnector?.stop();
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
