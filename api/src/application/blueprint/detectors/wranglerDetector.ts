/**
 * W2: Wrangler.toml detector
 *
 * Detects Cloudflare Worker configuration from wrangler.toml/wrangler.jsonc
 * - Service kind (worker)
 * - Bindings (Durable Objects, R2, KV, D1, Queues, AI, etc.)
 * - Secrets from [[vars]] comments
 * - Cron triggers
 */

import type { AppBlueprint, AppService, AppBinding, AppSecret, AppVar } from '@builderforce/creation-canvas-contract';
import type { BlueprintDetector, BlueprintDetectionResult } from '@builderforce/creation-canvas-contract';
import { SERVICE_KINDS, BINDING_KINDS } from '@builderforce/creation-canvas-contract';

/** Detect from wrangler.toml content. */
export function detectFromWrangler(content: string): Partial<AppBlueprint> {
  const result: Partial<AppBlueprint> = {
    sources: { wranglerToml: true, packageJson: false, viteConfig: false, nextConfig: false, expoConfig: false, capacitorConfig: false, drizzleConfig: false, prismaSchema: false, dockerfile: false, envExample: false, githubWorkflows: false, builderforceJson: false },
    overrides: null,
  };

  // Detect main service
  const service: AppService = {
    id: 'main',
    kind: SERVICE_KINDS.WORKER,
    rootDir: '.',
    packageManager: 'npm', // Default, will be overridden by package.json detector
    installCommand: 'npm install',
    devCommand: 'npx wrangler dev',
    buildCommand: 'npx wrangler deploy',
    startCommand: 'npx wrangler dev',
    verifyCommand: null,
    outputDir: 'dist',
    ports: [8787],
    envVars: [],
    isPrimary: true,
  };

  // Detect bindings from kv_namespaces
  const kvMatches = content.matchAll(/kv_namespaces\s*=\s*\[([\s\S]*?)\]/g);
  for (const match of kvMatches) {
    const bindings = parseBindings(match[1] || '', BINDING_KINDS.KV);
    result.bindings = [...(result.bindings || []), ...bindings];
  }

  // Detect R2 buckets
  const r2Matches = content.matchAll(/r2_buckets\s*=\s*\[([\s\S]*?)\]/g);
  for (const match of r2Matches) {
    const bindings = parseBindings(match[1] || '', BINDING_KINDS.R2);
    result.bindings = [...(result.bindings || []), ...bindings];
  }

  // Detect D1 databases
  const d1Matches = content.matchAll(/d1_databases\s*=\s*\[([\s\S]*?)\]/g);
  for (const match of d1Matches) {
    const bindings = parseBindings(match[1] || '', BINDING_KINDS.D1);
    result.bindings = [...(result.bindings || []), ...bindings];
  }

  // Detect Durable Objects
  const doMatches = content.matchAll(/durable_objects\s*=\s*\{[\s\S]*?bindings\s*=\s*\[([\s\S]*?)\]/g);
  for (const match of doMatches) {
    const classMatches = (match[1] || '').matchAll(/class\s*=\s*["']([^"']+)["']/g);
    for (const classMatch of classMatches) {
      if (classMatch[1]) {
        result.bindings?.push({
          name: classMatch[1],
          kind: BINDING_KINDS.DURABLE_OBJECT,
          className: classMatch[1],
          required: true,
        });
      }
    }
  }

  // Detect queues
  const queueMatches = content.matchAll(/queues\s*=\s*\[([\s\S]*?)\]/g);
  for (const match of queueMatches) {
    const bindings = parseBindings(match[1] || '', BINDING_KINDS.QUEUE);
    result.bindings = [...(result.bindings || []), ...bindings];
  }

  // Detect AI binding
  if (content.includes('ai')) {
    result.bindings?.push({
      name: 'AI',
      kind: BINDING_KINDS.AI,
      required: false,
    });
  }

  // Detect Vectorize
  if (content.includes('vectorize')) {
    result.bindings?.push({
      name: 'VECTORIZE',
      kind: BINDING_KINDS.VECTORIZE,
      required: false,
    });
  }

  // Detect cron triggers
  const cronMatch = content.match(/triggers\s*=\s*\{[\s\S]*?crons\s*=\s*\[([^\]]+)\]/);
  if (cronMatch && cronMatch[1]) {
    const cronExpr = cronMatch[1].trim().replace(/["']/g, '');
    result.bindings?.push({
      name: 'CRON',
      kind: BINDING_KINDS.CRON,
      cron: cronExpr,
      required: false,
    });
  }

  // Detect vars (non-secret environment variables)
  const varsMatch = content.match(/vars\s*=\s*\{([\s\S]*?)\}/);
  if (varsMatch && varsMatch[1]) {
    const varMatches = varsMatch[1].matchAll(/(\w+)\s*=\s*["']([^"']*)["']/g);
    for (const varMatch of varMatches) {
      if (varMatch[1]) {
        result.vars = result.vars || [];
        result.vars.push({
          name: varMatch[1],
          defaultValue: varMatch[2] || '',
        });
      }
    }
  }

  // Detect secrets from [[kv_namespaces]] comments or explicit secret declarations
  const secretMatches = content.matchAll(/#\s*secret\s+(\w+)/g);
  for (const match of secretMatches) {
    if (match[1]) {
      result.secrets = result.secrets || [];
      result.secrets.push({
        name: match[1],
        required: true,
      });
    }
  }

  // If main service has any bindings, include it
  if (result.bindings && result.bindings.length > 0) {
    result.services = [service];
  }

  return result;
}

function parseBindings(content: string, kind: string): AppBinding[] {
  const bindings: AppBinding[] = [];
  const idMatches = content.matchAll(/id\s*=\s*["']([^"']+)["']/g);
  for (const match of idMatches) {
    if (match[1]) {
      bindings.push({
        name: match[1],
        kind: kind as any,
        required: true,
      });
    }
  }
  return bindings;
}

/** Wrangler detector - reads wrangler.toml or wrangler.jsonc */
export const wranglerDetector: BlueprintDetector = {
  id: 'wrangler',
  name: 'Cloudflare Wrangler',
  reads: ['wrangler.toml', 'wrangler.jsonc'],
  detect: (files: Map<string, string>) => {
    const wranglerToml = files.get('wrangler.toml');
    const wranglerJsonc = files.get('wrangler.jsonc');

    if (wranglerToml) {
      return detectFromWrangler(wranglerToml);
    }
    if (wranglerJsonc) {
      return detectFromWrangler(wranglerJsonc);
    }
    return {};
  },
};
