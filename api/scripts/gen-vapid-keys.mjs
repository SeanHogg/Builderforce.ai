#!/usr/bin/env node
/**
 * Generate a VAPID keypair for Web Push, in the base64url form webPush.ts expects.
 *
 *   node api/scripts/gen-vapid-keys.mjs
 *
 * Then set the three secrets on the API worker (run once):
 *   cd api
 *   wrangler secret put VAPID_PUBLIC_KEY    # paste the public value
 *   wrangler secret put VAPID_PRIVATE_KEY   # paste the private value
 *   wrangler secret put VAPID_SUBJECT       # e.g. mailto:ops@builderforce.ai
 *
 * Public key  = base64url of the uncompressed P-256 point (0x04 || x || y), also
 *               handed to the browser as applicationServerKey.
 * Private key = base64url of the P-256 scalar d (the JWK `d` field).
 */
import { webcrypto as crypto } from 'node:crypto';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)); // 65 bytes
const jwk = await crypto.subtle.exportKey('jwk', privateKey); // jwk.d is already base64url

const publicB64url = Buffer.from(rawPublic).toString('base64url');

console.log('VAPID_PUBLIC_KEY=%s', publicB64url);
console.log('VAPID_PRIVATE_KEY=%s', jwk.d);
console.log('VAPID_SUBJECT=mailto:ops@builderforce.ai   # <- edit to a real contact');
