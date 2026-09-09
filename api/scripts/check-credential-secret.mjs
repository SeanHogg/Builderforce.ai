#!/usr/bin/env node
/**
 * Keep the two at-rest credential secrets resolved in exactly ONE place each.
 *
 * There are two chains and they are NOT interchangeable — which applies is decided by
 * the TABLE holding the ciphertext:
 *
 *   • `INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET`
 *     → `integration_credentials`  → application/integrations/integrationCredentialSecret.ts
 *   • `CREDENTIAL_ENCRYPTION_SECRET ?? INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET`
 *     → connector/LLM-key/MFA/SSO/artifact stores → application/integrations/credentialCrypto.ts
 *
 * They diverge the moment an operator sets `CREDENTIAL_ENCRYPTION_SECRET`, and using the
 * wrong one does not fail loudly: it derives a different PBKDF2 key and the row simply
 * will not open. That is why this is a guard and not a lint preference.
 *
 * The expression had been hand-copied to 42 sites plus three private helpers under two
 * different names — one of them named `credentialSecret`, colliding with the exported
 * three-level resolver of that exact name. This fails the build if either comes back.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const api = resolve(import.meta.dirname, '..');
const root = resolve(api, 'src');

/** The two modules allowed to spell a secret chain out. */
const OWNERS = new Set([
  'src/application/integrations/integrationCredentialSecret.ts',
  'src/application/integrations/credentialCrypto.ts',
]);

/** An inline `<recv>.INTEGRATION_ENCRYPTION_SECRET ?? <recv>.JWT_SECRET` chain. */
const INLINE_CHAIN = /INTEGRATION_ENCRYPTION_SECRET\s*\?\?[\s\S]{0,40}?JWT_SECRET/;
/** A private re-declaration of either resolver. */
const LOCAL_HELPER = /\b(?:function|const)\s+(?:credentialSecret|integrationCredentialSecret|gitSecret)\b/;

function filesUnder(path) {
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/** Strip comments so the guard reads CODE, not the prose that explains it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const violations = [];
for (const file of filesUnder(root)) {
  if (extname(file) !== '.ts' || /\.(?:test|spec)\.ts$/.test(file)) continue;
  const rel = relative(api, file).split('\\').join('/');
  if (OWNERS.has(rel)) continue;

  const code = stripComments(readFileSync(file, 'utf8'));
  if (INLINE_CHAIN.test(code)) {
    violations.push(`${rel} — inline secret chain; call integrationCredentialSecret(env) instead`);
  }
  const helper = code.match(LOCAL_HELPER);
  if (helper) {
    violations.push(`${rel} — re-declares '${helper[0].split(/\s+/).pop()}'; import the shared resolver instead`);
  }
}

if (violations.length) {
  console.error('Credential-secret resolution check failed:');
  violations.forEach((v) => console.error(`  - ${v}`));
  console.error('\nMatch the TABLE, not the module: integration_credentials → integrationCredentialSecret();');
  console.error('connector/LLM-key/MFA/SSO/artifact stores → credentialSecret(). Never "simplify" one onto the other.');
  process.exit(1);
}

console.log('Credential-secret resolution check passed: both chains resolved in exactly one place each.');
