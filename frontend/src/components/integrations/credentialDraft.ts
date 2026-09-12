/**
 * The connect form's rules, as pure functions over a catalog descriptor.
 *
 * The credential blob is stored and replaced WHOLESALE, so on edit the secret
 * fields are all-or-nothing: blank everywhere keeps the current key; filling any
 * one means rotating, and then every REQUIRED field must be filled or the
 * others would be dropped. Which fields are required is the catalog's call —
 * an optional field (Drive's root folder, PagerDuty's write-back email) never
 * blocks a save.
 */
import type { ConnectableProvider } from '@/lib/connectableCatalog';

export interface CredentialDraft {
  provider: string;
  name: string;
  baseUrl: string;
  secrets: Record<string, string>;
}

export type DraftProblem =
  | { kind: 'baseUrlRequired' }
  | { kind: 'fieldRequired' | 'rotateFieldMissing'; fieldKey: string };

const filled = (draft: CredentialDraft, key: string) => Boolean(draft.secrets[key]?.trim());

/** On edit: is the user rotating the key (any field filled)? */
export function isRotating(provider: ConnectableProvider, draft: CredentialDraft): boolean {
  return provider.credentialFields.some((field) => filled(draft, field.key));
}

export function draftProblem(provider: ConnectableProvider, draft: CredentialDraft, editing: boolean): DraftProblem | null {
  if (provider.baseUrl === 'required' && !draft.baseUrl.trim()) return { kind: 'baseUrlRequired' };
  if (editing && !isRotating(provider, draft)) return null;
  const missing = provider.credentialFields.find((field) => field.required && !filled(draft, field.key));
  if (missing) return { kind: editing ? 'rotateFieldMissing' : 'fieldRequired', fieldKey: missing.key };
  return null;
}

/** Exactly the declared fields that were filled, trimmed — nothing the catalog does not name. */
export function credentialsPayload(provider: ConnectableProvider, draft: CredentialDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of provider.credentialFields) {
    const value = draft.secrets[field.key]?.trim();
    if (value) out[field.key] = value;
  }
  return out;
}
