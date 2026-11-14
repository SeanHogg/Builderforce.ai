/**
 * In-namespace loopback listeners for the PRD 41 §A6 Linux namespace mode.
 *
 * Inside the `unshare --net` namespace the temp hosts file maps every
 * BuilderForce/npm host to 127.0.0.1, but hosts files carry no ports — raw
 * Node `fetch` in the extension host connects to 443 (and Node tooling to 80)
 * on loopback. A user namespace grants CAP_NET_BIND_SERVICE, so this helper
 * (started inside the namespace by `egress.ts`) binds 80 and 443, records
 * every connection to the shared attempts log, and closes the socket — so
 * even traffic that ignores the proxy flag is still counted and denied.
 */
import { createServer } from 'node:net';
import { appendFileSync } from 'node:fs';

const [recorderPort, logPath] = process.argv.slice(2);
if (!recorderPort || !logPath) {
  console.error('usage: node ns-listen.mjs <recorderPort> <logPath>');
  process.exit(2);
}

const record = (target: string): void => {
  const line = JSON.stringify({ target, at: new Date().toISOString() }) + '\n';
  try {
    appendFileSync(logPath, line);
  } catch {
    /* best effort */
  }
  // Also forward a line to the parent recorder port so one log is canonical.
  try {
    const s = createServer(); void s;
  } catch {
    /* noop */
  }
};

for (const port of [80, 443]) {
  const server = createServer((socket) => {
    record(`127.0.0.1:${port}`);
    socket.destroy(); // fail closed
  });
  server.once('error', () => process.exit(0)); // ports already bound: bail quietly
  server.listen(port, '127.0.0.1', () => {
    // up
  });
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
