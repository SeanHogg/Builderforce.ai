/**
 * The credential-field vocabulary — ONE meaning, ONE label per field key.
 *
 * Every connect form in the product (the SCM/PM/ITSM probes, the search keys,
 * the Google connectors, the Data + Marketing + Enrichment catalog) asks for its
 * credentials in terms of these keys. Declaring the label once per key, rather
 * than once per provider, is what lets the connect UI translate a field WITHOUT
 * the server shipping per-locale copy: the frontend renders
 * `integrationCredentials.fields.<key>`, and a key can only ever mean one thing.
 * The English label below stays authoritative for server-side messages
 * (`validateCredentials` → "API key is required.").
 *
 * A new field is a new key here (a compile-checked `CredentialFieldKey`) plus a
 * message in each frontend catalog — `connectableCatalog.test.ts` fails on a key
 * the catalogs do not carry, so a field cannot ship as a raw dotted path.
 */

export const CREDENTIAL_FIELD_LABELS = {
  apiKey: 'API key',
  apiToken: 'API token',
  accessToken: 'Access token',
  token: 'Auth token',
  email: 'Account email',
  username: 'Username',
  password: 'Password',
  fromEmail: 'From email',
  clientId: 'OAuth client ID',
  clientSecret: 'OAuth client secret',
  refreshToken: 'OAuth refresh token',
  rootFolderId: 'Root folder ID',
  connectionString: 'Connection string',
  projectUrl: 'Project URL',
  serviceKey: 'Service role key',
  endpoint: 'Endpoint',
  projectId: 'Project ID',
  account: 'Account identifier',
} as const;

export type CredentialFieldKey = keyof typeof CREDENTIAL_FIELD_LABELS;

/** One credential input on the connect form. */
export interface CredentialField {
  key: CredentialFieldKey;
  /** English label — derived from {@link CREDENTIAL_FIELD_LABELS}, never hand-written. */
  label: string;
  /** `secret` fields are masked on read-back and rendered as password inputs. */
  secret: boolean;
  required: boolean;
  /** A FORMAT example (`ghp_…`, `postgres://…`), not prose — so it is not translated. */
  placeholder?: string;
}

/**
 * Build a field from its key. Defaults describe the common case — a required
 * secret — so a declaration only states how it differs.
 */
export function credentialField(
  key: CredentialFieldKey,
  opts: { secret?: boolean; required?: boolean; placeholder?: string } = {},
): CredentialField {
  return {
    key,
    label: CREDENTIAL_FIELD_LABELS[key],
    secret: opts.secret ?? true,
    required: opts.required ?? true,
    ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
  };
}
