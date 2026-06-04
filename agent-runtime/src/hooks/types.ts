export type HookInstallSpec = {
  id?: string;
  kind: "bundled" | "npm" | "git";
  label?: string;
  package?: string;
  repository?: string;
  bins?: string[];
};

export type BuilderForceAgentsHookMetadata = {
  always?: boolean;
  hookKey?: string;
  emoji?: string;
  homepage?: string;
  /** Original author / publisher name */
  author?: string;
  /** Author homepage or profile URL */
  authorUrl?: string;
  /** SPDX license identifier */
  license?: string;
  /** Events this hook handles (e.g., ["command:new", "session:start"]) */
  events: string[];
  /** Optional export name (default: "default") */
  export?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: HookInstallSpec[];
};

export type HookInvocationPolicy = {
  enabled: boolean;
};

export type ParsedHookFrontmatter = Record<string, string>;

export type Hook = {
  name: string;
  description: string;
  source: "builderforce-bundled" | "builderforce-managed" | "builderforce-workspace" | "builderforce-plugin";
  pluginId?: string;
  filePath: string; // Path to HOOK.md
  baseDir: string; // Directory containing hook
  handlerPath: string; // Path to handler module (handler.ts/js)
};

export type HookSource = Hook["source"];

export type HookEntry = {
  hook: Hook;
  frontmatter: ParsedHookFrontmatter;
  metadata?: BuilderForceAgentsHookMetadata;
  invocation?: HookInvocationPolicy;
};

export type HookEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
};

export type HookSnapshot = {
  hooks: Array<{ name: string; events: string[] }>;
  resolvedHooks?: Hook[];
  version?: number;
};
