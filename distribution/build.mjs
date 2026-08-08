#!/usr/bin/env node
/**
 * Stamp the canonical listing copy (`distribution/listing.json`) into every
 * channel payload that is purely a listing artifact, and verify the manifests
 * that live elsewhere still agree with it.
 *
 * Marketplaces all want the same handful of strings — title, short description,
 * long description, icon, tags, endpoint — in slightly different shapes. Written
 * by hand they drift within a release or two, and a marketplace listing that
 * contradicts the product is not a small problem: it is what a buyer reads.
 *
 * Generated here:
 *   docker-mcp-registry/  → the PR payload for github.com/docker/mcp-registry
 *
 * Verified here (owned by their own subsystem, must not contradict the copy):
 *   ../server.json        → the MCP Registry listing for the remote server
 *
 * Usage:  node distribution/build.mjs [--check]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const CHECK = process.argv.includes('--check');

const listing = JSON.parse(fs.readFileSync(path.join(DIR, 'listing.json'), 'utf8'));

// ── Verify: the MCP Registry manifest ────────────────────────────────────────
// server.json is owned by the API (its version is pinned to the served
// serverInfo by a unit test), but its buyer-facing copy must come from here.
const serverJsonPath = path.join(ROOT, 'server.json');
const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
const mismatches = [];
if (serverJson.description !== listing.longDescription) mismatches.push('description');
if (serverJson.title !== listing.title) mismatches.push('title');
if (serverJson.websiteUrl !== listing.website) mismatches.push('websiteUrl');
if (serverJson.remotes?.[0]?.url !== listing.mcp.endpoint) mismatches.push('remotes[0].url');
if (serverJson.remotes?.[0]?.type !== listing.mcp.transport) mismatches.push('remotes[0].type');
if (mismatches.length > 0) {
  console.error(`✗ server.json disagrees with distribution/listing.json: ${mismatches.join(', ')}`);
  console.error('  Update server.json to match the canonical copy, or change the copy.');
  process.exit(1);
}

// ── Generate: the Docker MCP Catalog PR payload ──────────────────────────────
// Submitted as a PR to github.com/docker/mcp-registry, one directory per server.
// A remote entry needs no image: Docker lists the endpoint and discovers tools
// dynamically, so `tools.json` ships empty by their convention.
const dockerServerYaml = [
  `name: ${listing.name}`,
  'type: remote',
  'dynamic:',
  '  tools: true',
  'meta:',
  `  category: ${listing.category}`,
  '  tags:',
  ...listing.tags.map((t) => `    - ${t}`),
  'about:',
  `  title: ${listing.title}`,
  `  description: ${listing.shortDescription}`,
  `  icon: ${listing.icon}`,
  'source:',
  `  project: ${listing.repository}`,
  'remote:',
  `  transport_type: ${listing.mcp.transport}`,
  `  url: ${listing.mcp.endpoint}`,
  '',
].join('\n');

const dockerReadme = [
  `# ${listing.title}`,
  '',
  listing.longDescription,
  '',
  `Docs: ${listing.mcp.docs}`,
  '',
  '## Authentication',
  '',
  `Send a Builderforce tenant API key as \`${listing.mcp.authHeader}: Bearer bfk_…\`.`,
  'Create one in Settings → API keys. The key\'s tenant is the scope of every tool call.',
  '',
].join('\n');

const files = {
  [`docker-mcp-registry/${listing.name}/server.yaml`]: dockerServerYaml,
  [`docker-mcp-registry/${listing.name}/readme.md`]: dockerReadme,
  // Docker's convention for a dynamic remote server: the catalog discovers the
  // real tool list at runtime, so the committed file is an empty array.
  [`docker-mcp-registry/${listing.name}/tools.json`]: '[]\n',
};

let drift = 0;
for (const [rel, content] of Object.entries(files)) {
  const dest = path.join(DIR, rel);
  const current = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null;
  if (current === content) continue;
  drift += 1;
  if (CHECK) {
    console.error(`✗ out of date: distribution/${rel.replace(/\\/g, '/')}`);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log(`✓ wrote distribution/${rel.replace(/\\/g, '/')}`);
}

if (CHECK) {
  if (drift > 0) {
    console.error('\nRun `node distribution/build.mjs` and commit the result.');
    process.exit(1);
  }
  console.log('✓ distribution payloads are up to date');
}
