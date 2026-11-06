import { describe, expect, it } from 'vitest';
import { contentBadges } from './codeFileBadges.js';
import { EXTERNAL_SERVICE_SPECIFIERS, externalsBadge, MAX_EXTERNALS } from './externalServices.js';
import { extractSymbols } from '../symbols.js';

describe('externalsBadge', () => {
  it('names the known services a file imports, sorted and comma-joined', () => {
    expect(externalsBadge(['pg', 'openai', 'react'])).toBe('llm,postgres');
    expect(externalsBadge(['@octokit/rest', '@slack/web-api', 'stripe'])).toBe('github,slack,stripe');
    expect(externalsBadge(['@cloudflare/kv-asset-handler', '@ai-sdk/openai', 'nodemailer', 'next-auth/react'])).toBe('kv,llm,mail,oauth');
  });
  it('does not take Cloudflare tooling or type packages for a service, and reads @cloudflare/ai as an LLM', () => {
    expect(externalsBadge(['@cloudflare/workers-types', '@cloudflare/vitest-pool-workers', '@types/pg', 'openai-types'])).toBeUndefined();
    expect(externalsBadge(['@cloudflare/ai'])).toBe('llm');
    expect(externalsBadge(['@cloudflare/workers-types/2023-07-01', '@cloudflare/ai'])).toBe('llm');
  });
  it('matches a specifier by package, not by prefix of its name', () => {
    expect(externalsBadge(['pgtyped', 'openai-helpers', 'stripe-mock'])).toBeUndefined();
    expect(externalsBadge(['./pg', '../db'])).toBeUndefined();
    expect(externalsBadge([])).toBeUndefined();
  });
  it('can name every service, so none drops out of the badge', () => {
    expect(MAX_EXTERNALS).toBe(Object.keys(EXTERNAL_SERVICE_SPECIFIERS).length);
    const all = ['pg', 'ioredis', 'openai', 'octokit', 'stripe', 'nodemailer', '@slack/web-api', 'next-auth'];
    expect(externalsBadge(all)?.split(',')).toHaveLength(8);
  });
});

describe('the externals badge on a file', () => {
  it('is stored by contentBadges from the file\'s imports, and absent when there are none', () => {
    const text = "import { Pool } from 'pg';\nimport OpenAI from 'openai';\nexport const x = new Pool();\n";
    expect(contentBadges('src/db.ts', text, extractSymbols('src/db.ts', text))['externals']).toBe('llm,postgres');
    const plain = "import { a } from './a';\nexport const b = a;\n";
    expect(contentBadges('src/b.ts', plain, extractSymbols('src/b.ts', plain))['externals']).toBeUndefined();
  });
  it('does not count a type-only import as a use of the service', () => {
    const text = "import type { Pool } from 'pg';\nimport { type Client } from 'pg';\nexport type { Octokit } from '@octokit/rest';\nexport const x = 1;\n";
    expect(contentBadges('src/t.ts', text, extractSymbols('src/t.ts', text))['externals']).toBe('postgres');
    const onlyTypes = "import type { Pool } from 'pg';\nexport const x = 1;\n";
    expect(contentBadges('src/u.ts', onlyTypes, extractSymbols('src/u.ts', onlyTypes))['externals']).toBeUndefined();
  });
});
