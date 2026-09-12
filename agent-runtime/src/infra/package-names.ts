/** The npm package that ships the `builderforce` CLI. */
export const CORE_PACKAGE_NAME = "@seanhogg/builderforce-agents";

/** Earlier package names still recognised as this runtime (source checkouts and existing installs). */
export const LEGACY_PACKAGE_NAMES = ["builderforce"] as const;

/** Every package name that identifies this runtime's package root, current first. */
export const CORE_PACKAGE_NAMES: readonly string[] = [CORE_PACKAGE_NAME, ...LEGACY_PACKAGE_NAMES];

const CORE_PACKAGE_NAME_SET: ReadonlySet<string> = new Set(CORE_PACKAGE_NAMES);

export function isCorePackageName(name: string | null | undefined): boolean {
  return Boolean(name && CORE_PACKAGE_NAME_SET.has(name));
}

/** Strips a leading `<package>@` (any recognised package name) from a tag spec. */
export function stripPackagePrefix(tag: string): string {
  for (const name of CORE_PACKAGE_NAMES) {
    if (tag.startsWith(`${name}@`)) {
      return tag.slice(name.length + 1);
    }
  }
  return tag;
}
