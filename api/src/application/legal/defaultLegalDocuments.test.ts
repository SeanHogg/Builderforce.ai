import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILDERFORCE_PRIVACY_POLICY,
  BUILDERFORCE_TERMS_OF_USE,
  LEGAL_POLICY_VERSION,
} from './defaultLegalDocuments';

describe('BuilderForce legal policy v2', () => {
  it('contains no drafting placeholders and names the legal entity', () => {
    for (const document of [BUILDERFORCE_TERMS_OF_USE, BUILDERFORCE_PRIVACY_POLICY]) {
      expect(document).toContain('Fix Faster LLC');
      expect(document).toContain('BuilderForce.ai');
      expect(document).toContain('6513 Basswood Dr.');
      expect(document).toContain('Troy, MI 48098');
      expect(document).not.toMatch(/\[(your|company|application|insert|address)[^\]]*\]/i);
    }
  });

  it('records Michigan formation and governing law', () => {
    expect(BUILDERFORCE_TERMS_OF_USE).toContain('a Michigan limited liability company');
    expect(BUILDERFORCE_TERMS_OF_USE).toContain('laws of the State of Michigan');
    expect(BUILDERFORCE_PRIVACY_POLICY).toContain('a Michigan limited liability company');
  });

  it('preserves customer ownership and the no-sale/no-training commitments', () => {
    expect(BUILDERFORCE_TERMS_OF_USE).toMatch(/retain all right, title, and interest/i);
    expect(BUILDERFORCE_TERMS_OF_USE).toMatch(/do not sell Customer Content, chat history, or ideas/i);
    expect(BUILDERFORCE_PRIVACY_POLICY).toMatch(/prompts, chats, source code, files, ideas.*remain yours/i);
    expect(BUILDERFORCE_PRIVACY_POLICY).toMatch(/do not use Customer Content to train generalized AI models.*unless.*expressly opt in/i);
  });

  it('publishes the same material version through the migration', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../../../migrations/0403_builderforce_legal_v2_and_compliance_agent.sql', import.meta.url).href),
      'utf8',
    );
    expect(LEGAL_POLICY_VERSION).toBe('2.1.0');
    expect(migration).toContain("'2.1.0'");
    expect(migration).toContain('Terms of Use for BuilderForce.ai');
    expect(migration).toContain('Privacy Policy for BuilderForce.ai');
    expect(migration).toContain('a Michigan limited liability company');
    expect(migration).toContain('6513 Basswood Dr.');
    expect(migration).toContain('Troy, MI 48098');
    expect(migration).not.toMatch(/\[(your|company|application|insert|address)[^\]]*\]/i);
  });
});
