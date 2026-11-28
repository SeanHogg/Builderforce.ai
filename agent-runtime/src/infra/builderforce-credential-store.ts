import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { normalize, resolve } from "node:path";

type CredentialEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
};

type CredentialAddon = {
  Entry: new (service: string, account: string, options: { linux: { store: "secret-service" } }) => CredentialEntry;
};

const requireAddon = createRequire(import.meta.url);
const credentialNames = new Set(["BUILDERFORCE_API_KEY", "BUILDERFORCE_WEB_TOKEN"]);
let addon: CredentialAddon | null | undefined;
let warned = false;

export function isBuilderforceCredential(name: string): boolean {
  return credentialNames.has(name);
}

function openEntry(configDir: string, name: string): CredentialEntry | undefined {
  if (addon === undefined) {
    try {
      addon = requireAddon("@napi-rs/keyring") as CredentialAddon;
    } catch {
      addon = null;
    }
  }
  if (!addon) return;
  const absolute = normalize(resolve(configDir));
  const profile = createHash("sha256")
    .update(process.platform === "win32" ? absolute.toLowerCase() : absolute)
    .digest("hex");
  return new addon.Entry("ai.builderforce.runtime", `${profile}:${name}`, {
    linux: { store: "secret-service" },
  });
}

export function readBuilderforceCredential(configDir: string, name: string): string | undefined {
  try {
    return openEntry(configDir, name)?.getPassword() ?? undefined;
  } catch {
    return undefined;
  }
}

export function storeBuilderforceCredential(configDir: string, name: string, value: string): boolean {
  try {
    const entry = openEntry(configDir, name);
    if (!entry) return false;
    entry.setPassword(value);
    return true;
  } catch {
    return false;
  }
}

export function warnBuilderforceCredentialFallback(): void {
  if (warned) return;
  warned = true;
  process.emitWarning("Builderforce is using the local .env credential fallback. Signing in again with the system credential store available moves the credential into it.", {
    code: "BUILDERFORCE_CREDENTIAL_FALLBACK",
  });
}
