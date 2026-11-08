/**
 * Trust the platform's egress-interception CA for every process this server spawns.
 *
 * The run sandbox's outbound HTTPS is intercepted by the Worker (the egress allowlist,
 * `api/src/application/runtime/sandbox/egressAllowlist.ts`). The platform mounts its CA at
 * CA_PATH; git, npm/pnpm/yarn (node), pip and curl only trust it if told to. The image runs
 * as the unprivileged `node` user, so instead of `update-ca-certificates` this builds a
 * bundle (system roots + the platform CA) under /tmp and points the tools' env at it.
 * Imported once by server.mjs; spawned shells inherit `process.env`. No CA file ⇒ no-op.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const EGRESS_CA_PATH = '/etc/cloudflare/certs/cloudflare-containers-ca.crt';
const SYSTEM_BUNDLE = '/etc/ssl/certs/ca-certificates.crt';

/** Returns the bundle path it exported, or null when there is no platform CA to trust. */
export function trustEgressCa(env = process.env, caPath = EGRESS_CA_PATH, systemBundle = SYSTEM_BUNDLE, outDir = tmpdir()) {
  if (!existsSync(caPath)) {
    // The image ENV points NODE_EXTRA_CA_CERTS at the platform CA; with no CA mounted (enforcement
    // off) a dangling path only makes every spawned node tool warn, so drop it for them.
    delete env.NODE_EXTRA_CA_CERTS;
    return null;
  }
  const bundlePath = join(outDir, 'bf-egress-ca-bundle.crt');
  try {
    const system = existsSync(systemBundle) ? readFileSync(systemBundle, 'utf8') : '';
    writeFileSync(bundlePath, `${system}\n${readFileSync(caPath, 'utf8')}\n`);
  } catch (error) {
    // Never crash boot over trust setup: the sandbox still serves; TLS to intercepted hosts fails loudly.
    console.error(`egressTrust: could not write the CA bundle: ${error?.message ?? error}`);
    return null;
  }
  // Spawned node tools (npm / pnpm / yarn) pick this up from the env they inherit. THIS process
  // reads it only at start, so the Dockerfile also sets it as an image ENV.
  env.NODE_EXTRA_CA_CERTS = caPath;
  for (const name of ['SSL_CERT_FILE', 'GIT_SSL_CAINFO', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE', 'PIP_CERT']) env[name] = bundlePath;
  return bundlePath;
}

trustEgressCa();
