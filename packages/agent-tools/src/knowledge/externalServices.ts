/**
 * knowledge/externalServices.ts — the known outside services a file can import, as DATA: the
 * module specifiers that identify each one. A code file's `externals` badge is the ids of the
 * services it imports. The ids themselves (`EXTERNAL_SERVICE_IDS`) live in builderforce-memory's
 * knowledge module, so this writer and the map that names a line's end (knowledge-graph-view's
 * termini table) are typed against the same list. Pure.
 */

import type { ExternalServiceId } from '@seanhogg/builderforce-memory/knowledge';
import { importSpecifiers } from './codePatterns.js';

export type { ExternalServiceId };

/** Per service, the specifiers that import it. A `@cloudflare/*` package is NOT a service by itself: workers-types and the test pool are tooling. */
export const EXTERNAL_SERVICE_SPECIFIERS: Record<ExternalServiceId, RegExp[]> = {
  postgres: [/^(pg|postgres|pg-promise|drizzle-orm|prisma|@prisma\/client|@neondatabase\/[^/]+)(\/|$)/],
  kv: [/^(ioredis|redis|@upstash\/[^/]+|@aws-sdk\/client-s3|@cloudflare\/kv-asset-handler|@vercel\/kv|@vercel\/blob)(\/|$)/],
  llm: [/^(openai|ai|@anthropic-ai\/[^/]+|@ai-sdk\/[^/]+|@google\/generative-ai|@cloudflare\/ai)(\/|$)/],
  github: [/^(octokit|@octokit\/[^/]+)(\/|$)/],
  stripe: [/^(stripe|@stripe\/[^/]+)(\/|$)/],
  mail: [/^(nodemailer|resend|@sendgrid\/[^/]+|mailgun\.js)(\/|$)/],
  slack: [/^@slack\/[^/]+(\/|$)/],
  oauth: [/^(passport|next-auth|@auth\/[^/]+|arctic|oauth4webapi|openid-client)(\/|$)/],
};

/** Most ids one file's badge lists: all of them, so no service silently drops out. */
export const MAX_EXTERNALS = 8;

/** A specifier that only brings in types or tooling is not a use of the service. */
const TYPES_ONLY = /^@types\/|(^|\/)[^/]*-types$/;

/** The `externals` badge value for a file's import specifiers (ids sorted, comma-joined), or undefined when it imports none. */
export function externalsBadge(specifiers: readonly string[]): string | undefined {
  const real = specifiers.filter((spec) => !TYPES_ONLY.test(spec));
  const ids = (Object.keys(EXTERNAL_SERVICE_SPECIFIERS) as ExternalServiceId[])
    .filter((id) => EXTERNAL_SERVICE_SPECIFIERS[id].some((re) => real.some((spec) => re.test(spec))))
    .sort();
  return ids.length > 0 ? ids.slice(0, MAX_EXTERNALS).join(',') : undefined;
}

const TYPE_IMPORT = /\b(?:import|export)\s+type\b[^'"\n;]*(['"])[^'"\n]+\1/g;

/** The specifiers a source imports at RUN time: `import type … from 'x'` brings in nothing. */
export function runtimeSpecifiers(maskedCode: string): string[] {
  return importSpecifiers(maskedCode.replace(TYPE_IMPORT, ''));
}
