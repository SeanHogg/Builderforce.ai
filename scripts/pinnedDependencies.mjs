/**
 * THE pinned-dependency declaration — one version, named once, for the whole repo.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────
 * Some dependencies are not chosen by the projects that carry them. `sharp` is
 * nobody's direct dependency in most of this repo: it arrives under `next`, under
 * `@huggingface/transformers`, under `miniflare`, and each of those asks for a
 * different range. The only way to hold ONE version across a tree like that is an
 * `overrides` entry — and this repo had eight of them, each spelling the number
 * out again.
 *
 * That is a fact stored in eight places, and it drifted exactly the way a fact
 * stored in eight places drifts. When a `sharp` advisory landed, the number moved
 * in the eight manifests somebody remembered and stayed put in the three that had
 * no override at all: `worker` resolved 0.35.2 under miniflare, `clients/vscode`
 * and `webdit/runtime` resolved 0.34.5 under transformers. Dependabot could not
 * fix any of them, because a transitive package has no direct requirement to bump
 * — it opened a security job, found nothing to unlock, and failed.
 *
 * So the version lives HERE, once, and {@link ../scripts/check-pinned-deps.mjs}
 * makes every project agree with it. Bumping a pin is editing one line.
 *
 * ── WHAT A PIN MEANS ──────────────────────────────────────────────────────────
 * EXACT, never a range. A caret pin states a floor and then lets the lockfile
 * choose, which is fine for a preference and useless for a security floor: the
 * question "is this repo on the patched version" stops having one answer. An
 * exact pin makes the lockfiles checkable against this file by string equality,
 * and makes the next bump a single number rather than a survey.
 *
 * A pin is not a general place to park version preferences. It is for a package
 * that (a) arrives transitively in more than one project, so no single manifest
 * governs it, and (b) has a reason to be held at one version — a security floor,
 * a native ABI, a known-bad release. Anything a project owns outright belongs in
 * that project's `dependencies`, where its own tooling can see it.
 */

/**
 * @typedef {object} PinnedDependency
 * @property {string} name    The npm package name.
 * @property {string} version The exact version every project must resolve.
 * @property {string} reason  Why it is held. Read by the guard's failure output,
 *                            so the next person is told the reason rather than
 *                            just the rule.
 */

/** @type {readonly PinnedDependency[]} */
export const PINNED_DEPENDENCIES = [
  {
    name: 'sharp',
    version: '0.35.4',
    reason:
      'GHSA advisories affect every sharp below 0.35.4. It is transitive in ten '
      + 'lockfiles here (next, @huggingface/transformers, miniflare, astro) and a '
      + 'direct dependency in two, so an override is the only thing that reaches it.',
  },
];

/** The pin for `name`, or `null` if that package is not pinned. */
export function pinFor(name) {
  return PINNED_DEPENDENCIES.find((pin) => pin.name === name) ?? null;
}

/**
 * Where a manifest states an override, across the two shapes in this repo.
 *
 * pnpm reads `pnpm.overrides`; npm reads top-level `overrides`. `webdit` and
 * `docs-site` are npm workspaces and use the second, everything else uses the
 * first, and a project may legitimately carry both if it is installed either way.
 */
export function overrideEntries(manifest) {
  return [
    ['pnpm.overrides', manifest?.pnpm?.overrides],
    ['overrides', manifest?.overrides],
  ].filter(([, table]) => table && typeof table === 'object');
}

/**
 * What version a manifest holds `name` at, and where it said so.
 *
 * Resolves pnpm's `"$name"` alias — an override of `"$sharp"` means "whatever
 * this manifest's own dependencies ask for", so the answer is that requirement,
 * not the literal. Returns every statement found, because a manifest that pins
 * one number in `dependencies` and a different one in `overrides` is itself the
 * defect and the guard has to be able to say both.
 *
 * @returns {{ where: string, value: string }[]}
 */
export function declaredPins(manifest, name) {
  const found = [];
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const value = manifest?.[field]?.[name];
    if (typeof value === 'string') found.push({ where: field, value });
  }
  for (const [where, table] of overrideEntries(manifest)) {
    const value = table[name];
    if (typeof value !== 'string') continue;
    // `$name` defers to this manifest's own requirement for the same package.
    if (value === `$${name}`) {
      const target = found.find((entry) => entry.where !== where);
      found.push({ where, value: target ? target.value : value });
      continue;
    }
    found.push({ where, value });
  }
  return found;
}

/** True when a manifest states the pin somewhere an installer will act on. */
export function statesOverride(manifest, name) {
  return overrideEntries(manifest).some(([, table]) => typeof table[name] === 'string');
}

/**
 * Every version of `name` a lockfile resolves, across both lockfile formats.
 *
 * pnpm's YAML lists a package as `  sharp@0.35.4:` at the top of the `snapshots`
 * and `packages` sections, sometimes with a peer suffix — `sharp@0.35.4(@types/
 * node@25.5.0):` — which is the same version under a different resolution
 * context. npm's JSON keys every install path under `packages`, so the name is
 * the last `node_modules/` segment.
 *
 * Read as TEXT rather than parsed: these files run to tens of thousands of lines,
 * a YAML dependency in a guard that must run everywhere is a cost, and the shape
 * being matched — a package header at a known indent — is stable across every
 * lockfile version in the repo.
 */
export function lockedVersions(lockText, lockPath, name) {
  const versions = new Set();
  if (lockPath.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(lockText);
    } catch {
      return versions;
    }
    for (const [path, entry] of Object.entries(parsed?.packages ?? {})) {
      if (path.split('node_modules/').pop() !== name) continue;
      if (typeof entry?.version === 'string') versions.add(entry.version);
    }
    return versions;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^ {2}${escaped}@([0-9][^:(]*)`, 'gm');
  for (const match of lockText.matchAll(header)) versions.add(match[1]);
  return versions;
}
