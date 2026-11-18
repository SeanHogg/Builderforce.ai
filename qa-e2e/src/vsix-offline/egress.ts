/**
 * Egress denial + recording for the PRD 41 §A6 packaged acceptance scenario
 * (Builderforce.ai/docs/specs/make.md (PRD 41),
 * workstream WS13).
 *
 * This is the OS-level half of the two-layer denial the PRD requires
 * ("Every attempt is counted by the host fetch guard and an OS-level socket
 * counter"):
 *
 *   1. The host fetch guard lives INSIDE the shipped VSIX
 *      (`clients/vscode/src/platformPolicy.ts`, `platformRequestAccount()`)
 *      and is asserted through the recorder below — any platform/npm request
 *      that escapes the guard still cannot leave the machine.
 *   2. This module is the socket counter. Two mechanisms, following the G27
 *      packaged-acceptance design (`docs/design/local-first-closure-g03-g21-g23-g27.md`):
 *        - a loopback CONNECT recorder the whole instance is pointed at with
 *          Electron's `--proxy-server` flag: every attempted egress is logged
 *          with its target host:port and the socket is destroyed (fail closed);
 *        - where the OS allows it, a real denial in front of that: a Linux
 *          `unshare --user --net --mount` namespace with a temp hosts file that
 *          maps every platform/npm host to the recorder, or a Windows
 *          `netsh advfirewall` block rule for the VS Code executable.
 *
 * The assertion is allow-list style: VS Code's own update/telemetry/gallery
 * traffic is expected and ignored; ANY recorded attempt whose target is a
 * BuilderForce origin or npm is a hard failure of PRD 41 §A6.
 */

import { createServer, type Server, type Socket } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

/** Hosts that must receive zero requests for the A6 gate to pass. */
export const PLATFORM_AND_NPM_HOSTS: readonly string[] = [
  'builderforce.ai',
  'www.builderforce.ai',
  'api.builderforce.ai',
  'registry.npmjs.org',
  'registry.npmjs.com',
  'npmjs.org',
  'www.npmjs.org',
];

export function isDeniedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, '');
  return PLATFORM_AND_NPM_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

export interface RecordedAttempt {
  readonly target: string;
  readonly at: string;
}

export interface EgressRecorderBase {
  readonly port: number;
  readonly attempts: readonly RecordedAttempt[];
  readonly deniedAttempts: readonly RecordedAttempt[];
  /** Merge an attempt recorded by an in-namespace helper (ns-listen.mjs). */
  recordExternal(target: string): void;
  close(): Promise<void>;
}

export interface EgressRecorder extends EgressRecorderBase {
  /** 'namespace' | 'firewall' | 'proxy-only' — what enforced the OS-level denial. */
  readonly mode: string;
}

/**
 * A minimal fail-closed HTTP proxy. It records the CONNECT authority (or the
 * absolute-URI host) of every request and then destroys the socket — it never
 * forwards a byte, so even a request that somehow escapes the VSIX fetch guard
 * cannot reach BuilderForce or npm, and its attempt is counted.
 */
export async function startEgressRecorder(): Promise<EgressRecorderBase> {
  const attempts: RecordedAttempt[] = [];
  let resolveClosed!: () => void;
  const closed = new Promise<void>((r) => (resolveClosed = r));
  let server: Server | undefined;

  const record = (target: string): void => {
    attempts.push({ target, at: new Date().toISOString() });
  };

  server = createServer((socket) => {
    socket.once('data', (chunk) => {
      const line = chunk.toString('latin1').split('\r\n')[0] ?? '';
      // `CONNECT registry.npmjs.org:443 HTTP/1.1`
      const connect = /^CONNECT\s+(\S+)\s+HTTP\//i.exec(line);
      // `GET https://api.builderforce.ai/... HTTP/1.1` (absolute form)
      const absolute = /^[A-Z]+\s+https?:\/\/([^/\s]+)\S*\s+HTTP\//i.exec(line);
      record(connect ? connect[1] : absolute ? absolute[1] : line.slice(0, 120));
      socket.destroy(); // fail closed: nothing is forwarded, ever
    });
    socket.once('error', () => socket.destroy());
    socket.setTimeout(5_000, () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, '127.0.0.1', () => resolve());
  });
  server.once('close', () => resolveClosed());
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('recorder bound to a pipe?');
  const port = address.port;

  return {
    port,
    get attempts() {
      return attempts;
    },
    get deniedAttempts() {
      return attempts.filter((a) => isDeniedHost(a.target.replace(/:\d+$/, '')));
    },
    recordExternal(target: string): void {
      record(target);
    },
    close: async () => {
      for (const socket of socketsOf(server!)) socket.destroy();
      server!.close();
      await closed;
    },
  };
}

/** Best-effort: the net module keeps no public socket list; track via connection event. */
const trackedSockets = new WeakMap<Server, Set<Socket>>();
function socketsOf(server: Server): Set<Socket> {
  let set = trackedSockets.get(server);
  if (!set) {
    set = new Set();
    trackedSockets.set(server, set);
    server.on('connection', (s) => {
      set!.add(s);
      s.once('close', () => set!.delete(s));
    });
  }
  return set;
}

export interface EgressControl {
  readonly recorder: EgressRecorder;
  /** Args to pass to the VS Code launch so all Chromium traffic hits the recorder. */
  readonly launchArgs: string[];
  /** Wrap a spawn of `command args…` in the OS-level denial, when available. */
  wrap(command: string, args: string[]): { command: string; args: string[] };
  dispose(): Promise<void>;
}

/**
 * Bring up the strongest egress denial this host can enforce. Never throws:
 * an OS that grants neither namespaces nor firewall access still gets the
 * fail-closed recorder (mode 'proxy-only'), which both denies and counts.
 */
export async function startEgressControl(codeExecutable: string): Promise<EgressControl> {
  const base = await startEgressRecorder();
  const disposers: Array<() => Promise<void> | void> = [];

  if (process.platform === 'linux') {
    const ns = tryLinuxNamespace(base);
    if (ns) {
      disposers.push(ns.dispose);
      return {
        recorder: { ...base, mode: 'namespace' } as EgressRecorder,
        launchArgs: [],
        wrap: ns.wrap,
        dispose: async () => {
          await base.close();
          for (const d of disposers) await d();
        },
      };
    }
  }

  if (process.platform === 'win32') {
    const fw = tryWindowsFirewall(codeExecutable);
    if (fw) {
      disposers.push(fw.dispose);
      return {
        recorder: { ...base, mode: 'firewall' } as EgressRecorder,
        launchArgs: [`--proxy-server=http://127.0.0.1:${base.port}`],
        wrap: (command, args) => ({ command, args }),
        dispose: async () => {
          await base.close();
          for (const d of disposers) await d();
        },
      };
    }
  }

  return {
    recorder: { ...base, mode: 'proxy-only' } as EgressRecorder,
    launchArgs: [`--proxy-server=http://127.0.0.1:${base.port}`],
    wrap: (command, args) => ({ command, args }),
    dispose: async () => {
      await base.close();
      for (const d of disposers) await d();
    },
  };
}

/**
 * Linux: `unshare --user --net --mount` with a temp hosts file bind-mounted
 * over /etc/hosts inside the namespace. Every platform/npm host resolves to
 * the recorder on 127.0.0.1, so even traffic that ignores the proxy (raw
 * Node `fetch` in the extension host) lands on the recorder and is counted.
 * Returns undefined when unshare/ip are unavailable (no root needed with
 * user namespaces, but many CI images disable them).
 */
function tryLinuxNamespace(
  recorder: EgressRecorderBase,
): { wrap(command: string, args: string[]): { command: string; args: string[] }; dispose(): void } | undefined {
  const unshare = which('unshare');
  const ip = which('ip');
  if (!unshare || !ip) return undefined;

  const dir = mkdtempSync(path.join(tmpdir(), 'bf-a6-hosts-'));
  const hostsPath = path.join(dir, 'hosts');
  // Hosts files cannot carry ports: map every platform/npm host to 127.0.0.1,
  // and inside the namespace (where a user namespace grants CAP_NET_BIND_SERVICE)
  // the ns-listen helper binds 80/443, records each connection into the shared
  // log, and closes the socket — so even raw Node fetch in the extension host,
  // which ignores the proxy flag, is still counted and denied.
  writeFileSync(
    hostsPath,
    ['127.0.0.1 localhost', ...PLATFORM_AND_NPM_HOSTS.map((h) => `127.0.0.1 ${h}`), ''].join('\n'),
  );

  const nsLog = path.join(dir, 'ns-attempts.jsonl');
  const script = path.join(dir, 'a6-ns.sh');
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      '# PRD 41 §A6 namespace wrapper (G27 design): fresh user+net+mount namespace,',
      '# loopback up, temp hosts file bound over /etc/hosts, recorder listeners on',
      '# 80/443 so hosts-redirected attempts are counted and denied.',
      'set -e',
      'ip link set lo up',
      `mount --bind ${shQuote(hostsPath)} /etc/hosts`,
      `node ${shQuote(path.join(__dirname, 'ns-listen.mjs'))} ${shQuote(nsLog)} &`,
      'exec "$@"',
      '',
    ].join('\n'),
  );

  return {
    wrap: (command, args) => ({
      command: unshare,
      args: ['--user', '--net', '--mount', '--map-root-user', 'sh', script, command, ...args],
    }),
    dispose: () => {
      // Fold any attempts the in-namespace helper recorded into the main log.
      try {
        for (const line of readFileSync(nsLog, 'utf8').split('\n')) {
          const t = line.trim();
          if (!t) continue;
          try {
            recorder.recordExternal((JSON.parse(t) as { target: string }).target);
          } catch {
            recorder.recordExternal(t);
          }
        }
      } catch {
        /* namespace helper never ran */
      }
      // Nothing else persists: the namespace dies with the child.
      void dir;
    },
  };
}

/** Windows: one outbound block rule scoped to the VS Code executable. */
function tryWindowsFirewall(
  codeExecutable: string,
): { dispose(): void } | undefined {
  const netsh = which('netsh');
  if (!netsh) return undefined;
  const ruleName = `BF-A6-Egress-${process.pid}`;
  try {
    execFileSync(
      netsh,
      ['advfirewall', 'firewall', 'add', 'rule', `name=${ruleName}`, 'dir=out', 'action=block', `program=${codeExecutable}`, 'enable=yes'],
      { stdio: 'ignore' },
    );
  } catch {
    return undefined; // not elevated / policy denies — proxy-only fallback
  }
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        execFileSync(netsh, ['advfirewall', 'firewall', 'delete', 'rule', `name=${ruleName}`], { stdio: 'ignore' });
      } catch {
        /* rule outlives the run; named per-pid so CI cleanup can sweep */
      }
    },
  };
}

function which(bin: string): string | undefined {
  const pathEnv = process.env.PATH ?? '';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
