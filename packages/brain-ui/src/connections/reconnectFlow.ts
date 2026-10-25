/**
 * THE subscription reconnect, as a state machine every surface drives the same way: start
 * the gateway's connect, open the provider's page, then either take the pasted code
 * (`paste` grant) or wait for the approval (`device` grant).
 *
 * It lives OUTSIDE React, one flow per (client, provider), because the surfaces that show
 * it come and go mid-connect: the composer's `/` menu closes on any click outside it, and
 * a device approval happens in another tab. A flow owned by the row would be aborted the
 * moment the person clicked back into the chat — an approved Kimi grant would then never
 * be redeemed (the server stores it only when a poll sees the approval). Here the wait
 * runs to its end, and a reopened menu shows the flow where it is.
 *
 * Every await is fenced by a generation number, so a cancelled or superseded flow's late
 * answer can never land on the flow that replaced it.
 */
import type { ProviderConnectionsPort, ProviderConnectStart } from './types';

export type ReconnectPhase = 'idle' | 'starting' | 'paste' | 'device' | 'finishing';
export type ReconnectFailureReason = 'unavailable' | 'denied' | 'expired' | 'failed';

export interface ReconnectFailure {
  reason: ReconnectFailureReason;
  /** The gateway's own sentence, when it gave one. */
  detail: string | null;
}

export interface ReconnectState {
  phase: ReconnectPhase;
  userCode: string | null;
  code: string;
  failure: ReconnectFailure | null;
  /** Bumped on every completed connect — how a mounted view learns one finished. */
  connected: number;
}

type FlowClient = Pick<ProviderConnectionsPort, 'start' | 'completePaste' | 'awaitDevice'>;

const REASONS: readonly ReconnectFailureReason[] = ['unavailable', 'denied', 'expired', 'failed'];

/** The port's error contract is `{ reason, detail? }`; `cancelled` is the person's choice, not a failure. */
function failureOf(error: unknown): ReconnectFailure | null {
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (reason === 'cancelled') return null;
  const detail = (error as { detail?: unknown } | null)?.detail;
  return {
    reason: REASONS.includes(reason as ReconnectFailureReason) ? (reason as ReconnectFailureReason) : 'failed',
    detail: typeof detail === 'string' && detail ? detail : error instanceof Error && !reason ? error.message : null,
  };
}

const IDLE: ReconnectState = { phase: 'idle', userCode: null, code: '', failure: null, connected: 0 };

export class ReconnectFlow {
  private state: ReconnectState = IDLE;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private started: ProviderConnectStart | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly client: FlowClient, private readonly provider: string) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  snapshot = (): ReconnectState => this.state;

  private set(patch: Partial<ReconnectState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The ONE place a flow is torn down, so every ending leaves the same state. Returns the new generation. */
  private reset(patch: Partial<ReconnectState> = {}): number {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    this.started = null;
    this.set({ phase: 'idle', userCode: null, code: '', ...patch });
    return this.generation;
  }

  private succeed(): void {
    this.reset({ failure: null, connected: this.state.connected + 1 });
  }

  setCode = (code: string): void => this.set({ code });

  /** Run the connect. Resolves true once the gateway stored the connection. */
  start = async (openUrl: (url: string) => void): Promise<boolean> => {
    const generation = this.reset({ failure: null });
    this.set({ phase: 'starting' });
    let begun: ProviderConnectStart;
    try {
      begun = await this.client.start(this.provider);
    } catch (error) {
      if (generation === this.generation) this.reset({ failure: failureOf(error) });
      return false;
    }
    if (generation !== this.generation) return false;
    this.started = begun;
    openUrl(begun.authorizeUrl);
    if (begun.grant === 'paste') {
      this.set({ phase: 'paste' });
      return this.awaitPaste(generation);
    }
    this.set({ phase: 'device', userCode: begun.userCode });
    const controller = new AbortController();
    this.abort = controller;
    try {
      await this.client.awaitDevice(this.provider, begun, controller.signal);
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.reset({ failure: failureOf(error) });
      return false;
    }
    if (generation !== this.generation || controller.signal.aborted) return false;
    this.succeed();
    return true;
  };

  /** For a paste grant `start` resolves when the pasted code is redeemed, or the flow ends otherwise. */
  private awaitPaste(generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const before = this.state.connected;
      const off = this.subscribe(() => {
        if (this.state.connected !== before) { off(); resolve(true); return; }
        if (this.generation !== generation) { off(); resolve(false); }
      });
    });
  }

  finish = async (): Promise<void> => {
    const begun = this.started;
    const pasted = this.state.code.trim();
    if (!begun || !pasted || this.state.phase !== 'paste') return;
    const generation = this.generation;
    this.set({ phase: 'finishing', failure: null });
    try {
      await this.client.completePaste(this.provider, pasted, begun.state);
    } catch (error) {
      if (generation !== this.generation) return;
      const why = failureOf(error);
      // A dead code leaves nothing to retry — back to the start, not to the same box.
      if (why?.reason === 'expired') this.reset({ failure: why });
      else this.set({ phase: 'paste', failure: why });
      return;
    }
    if (generation === this.generation) this.succeed();
  };

  cancel = (): void => { this.reset({ failure: null }); };
}

/** One flow per client and provider — every view of that account drives the same one. */
const flows = new WeakMap<object, Map<string, ReconnectFlow>>();

export function reconnectFlow(client: FlowClient, provider: string): ReconnectFlow {
  let byProvider = flows.get(client);
  if (!byProvider) { byProvider = new Map(); flows.set(client, byProvider); }
  let flow = byProvider.get(provider);
  if (!flow) { flow = new ReconnectFlow(client, provider); byProvider.set(provider, flow); }
  return flow;
}
