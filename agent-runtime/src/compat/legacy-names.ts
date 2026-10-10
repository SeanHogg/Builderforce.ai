export const PROJECT_NAME = "builderforce" as const;

export const LEGACY_PROJECT_NAMES = ["builderforce"] as const;

export const MANIFEST_KEY = PROJECT_NAME;

export const LEGACY_MANIFEST_KEYS = LEGACY_PROJECT_NAMES;

export const LEGACY_PLUGIN_MANIFEST_FILENAMES = [] as const;

export const LEGACY_CANVAS_HANDLER_NAMES = [] as const;

// Relative to agent-runtime/ (the cwd tests and scripts run from): the macOS app
// lives at the monorepo root, `apps/macos/Sources/Builderforce`.
export const MACOS_APP_SOURCES_DIR = "../apps/macos/Sources/Builderforce" as const;

export const LEGACY_MACOS_APP_SOURCES_DIRS = [] as const;
