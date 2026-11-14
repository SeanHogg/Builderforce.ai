/**
 * rules/support/configRule.ts — the C5.6 config / infra surface rules' shared shape: which files each
 * reads, the text it scans (comment-masked code for a source file, the raw text for YAML / TOML / env /
 * Dockerfiles, whose `//` or `#` the JS masker would misread), and {@link configPatternRule}: ONE rule
 * per `insecureConfig` registry key.
 *
 * Each `insecureConfig` key is matched in ONE memoized pass per view ({@link insecureConfigHits}). Built-in
 * patterns run over the whole text (`gm`, combined); repo-added ones line by line, capped (`registryHits`).
 */
import { DEFAULT_REGISTRIES } from '../../registry/defaults.js';
import { isCodePath, isSnapshotPath, isTestPath, squash } from './files.js';
import { registryHits, registryPatterns, stateSides } from './stateRule.js';
export const isWorkflowPath = (p) => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
export const isDockerfilePath = (p) => /(^|\/)(Dockerfile|Containerfile)(\.[^/]+)?$/.test(p) || /\.dockerfile$/i.test(p);
export const isComposePath = (p) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i.test(p);
export const isWranglerPath = (p) => /(^|\/)wrangler\.(toml|jsonc?)$/.test(p);
/** Any non-test, non-doc file: code, config, headers, HTML. */
export const isSurfacePath = (p) => !isTestPath(p) && !isSnapshotPath(p) && !/\.(md|mdx|txt|rst|adoc)$/i.test(p);
/** A config named for a non-production environment (or a template of one): never a production config. */
const NON_PROD_NAME = /(^|[/._-])(dev|development|local|test|testing|override|example|sample|template)([/._-]|$)/i;
/** A production deploy / runtime config: wrangler, Docker, compose, `.env.production`, or a `prod`-named config file. */
export function isProdConfigPath(p) {
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (NON_PROD_NAME.test(base))
        return false;
    if (isWranglerPath(p) || isDockerfilePath(p) || isComposePath(p))
        return true;
    if (/^\.env\.prod/i.test(base))
        return true;
    return /(^|[/._-])prod(uction)?([/._-]|$)/i.test(p) && /\.(json|jsonc|ya?ml|toml|ini|conf|cfg|properties|env)$/i.test(base);
}
/** The text a config rule scans on one side. */
export const scanText = (view) => (isCodePath(view.path) ? view.code : view.text);
const hitOf = (offset, match) => ({ offset, length: match[0].length, key: squash(match[0]).slice(0, 60) });
/**
 * One `insecureConfig` key's hits on one side, memoized per view and key: ONE combined pass over the
 * key's vetted patterns (each skipped outright when its mandatory literal is absent). Per key, not all
 * keys at once, so a key is only ever matched in the files its rule reads (`debug-enabled` never scans
 * a `.ts` file) and `cors-credentials` only where `cors-permissive` hit.
 */
export function insecureConfigHits(view, input, key) {
    return view.memo(`insecureConfig:${key}`, () => {
        const sources = input.registries.insecureConfig[key] ?? [];
        if (sources.length === 0)
            return [];
        const patterns = registryPatterns(sources, DEFAULT_REGISTRIES.insecureConfig[key] ?? []);
        return registryHits(patterns, scanText(view), view.lineStarts()).map(({ offset, match }) => hitOf(offset, match));
    });
}
/** A rule whose findings are the `insecureConfig[id]` pattern hits in its files. */
export function configPatternRule(spec) {
    const rule = {
        id: spec.id,
        version: 1,
        dimension: 'security',
        reads: ['content'],
        derive(input) {
            if ((input.registries.insecureConfig[spec.id] ?? []).length === 0)
                return { before: [], after: [] };
            return stateSides(rule, {
                files: spec.files,
                hits: (view) => {
                    const hits = insecureConfigHits(view, input, spec.id);
                    return spec.keep ? hits.filter((h) => spec.keep(view, h)) : [...hits];
                },
                severity: spec.severity,
            }, input);
        },
    };
    return rule;
}
//# sourceMappingURL=configRule.js.map