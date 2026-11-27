/**
 * Secret skill parameters, kept in the editor's `SecretStorage` (the OS keychain),
 * keyed `skill:<id>:<param>`. A secret is never written to the experience store, a
 * routine, the audit trail or the helper's argv: it is read here at run time and sent
 * to the helper on stdin only.
 */

/** The slice of `vscode.SecretStorage` this needs (also what tests fake). */
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface SkillSecrets {
  get(skillId: string, param: string): Promise<string | undefined>;
  set(skillId: string, param: string, value: string): Promise<void>;
  /** Forget every secret a skill kept (when the skill is deleted). */
  clear(skillId: string, params: readonly string[]): Promise<void>;
}

export const secretKey = (skillId: string, param: string): string => `skill:${skillId}:${param}`;

export function createSkillSecrets(store: SecretStore): SkillSecrets {
  return {
    async get(skillId, param) {
      return (await store.get(secretKey(skillId, param))) || undefined;
    },
    async set(skillId, param, value) {
      await store.store(secretKey(skillId, param), value);
    },
    async clear(skillId, params) {
      for (const p of params) await store.delete(secretKey(skillId, p));
    },
  };
}
