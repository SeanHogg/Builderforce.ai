import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import {
  getFrontmatterString,
  normalizeStringList,
  parseBuilderForceAgentsManifestInstallBase,
  parseFrontmatterBool,
  resolveBuilderForceAgentsManifestBlock,
  resolveBuilderForceAgentsManifestInstall,
  resolveBuilderForceAgentsManifestOs,
  resolveBuilderForceAgentsManifestRequires,
} from "../shared/frontmatter.js";
import type {
  BuilderForceAgentsHookMetadata,
  HookEntry,
  HookInstallSpec,
  HookInvocationPolicy,
  ParsedHookFrontmatter,
} from "./types.js";

export function parseFrontmatter(content: string): ParsedHookFrontmatter {
  return parseFrontmatterBlock(content);
}

function parseInstallSpec(input: unknown): HookInstallSpec | undefined {
  const parsed = parseBuilderForceAgentsManifestInstallBase(input, ["bundled", "npm", "git"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec: HookInstallSpec = {
    kind: parsed.kind as HookInstallSpec["kind"],
  };

  if (parsed.id) {
    spec.id = parsed.id;
  }
  if (parsed.label) {
    spec.label = parsed.label;
  }
  if (parsed.bins) {
    spec.bins = parsed.bins;
  }
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.repository === "string") {
    spec.repository = raw.repository;
  }

  return spec;
}

export function resolveBuilderForceAgentsMetadata(
  frontmatter: ParsedHookFrontmatter,
): BuilderForceAgentsHookMetadata | undefined {
  const metadataObj = resolveBuilderForceAgentsManifestBlock({ frontmatter });

  // Author attribution lives in top-level frontmatter
  const author = getFrontmatterString(frontmatter, "author");
  const authorUrl = getFrontmatterString(frontmatter, "author-url");
  const license = getFrontmatterString(frontmatter, "license");

  if (!metadataObj) {
    if (author || authorUrl || license) {
      return { author, authorUrl, license, events: [] };
    }
    return undefined;
  }
  const requires = resolveBuilderForceAgentsManifestRequires(metadataObj);
  const install = resolveBuilderForceAgentsManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveBuilderForceAgentsManifestOs(metadataObj);
  const eventsRaw = normalizeStringList(metadataObj.events);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    hookKey: typeof metadataObj.hookKey === "string" ? metadataObj.hookKey : undefined,
    export: typeof metadataObj.export === "string" ? metadataObj.export : undefined,
    author,
    authorUrl,
    license,
    os: osRaw.length > 0 ? osRaw : undefined,
    events: eventsRaw.length > 0 ? eventsRaw : [],
    requires: requires,
    install: install.length > 0 ? install : undefined,
  };
}

export function resolveHookInvocationPolicy(
  frontmatter: ParsedHookFrontmatter,
): HookInvocationPolicy {
  return {
    enabled: parseFrontmatterBool(getFrontmatterString(frontmatter, "enabled"), true),
  };
}

export function resolveHookKey(hookName: string, entry?: HookEntry): string {
  return entry?.metadata?.hookKey ?? hookName;
}
