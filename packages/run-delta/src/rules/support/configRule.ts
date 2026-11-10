/**
 * rules/support/configRule.ts — the C5.6 config / infra surface rules' shared shape: which files each
 * reads, the text it scans (comment-masked code for a source file, the raw text for YAML / TOML / env /
 * Dockerfiles, whose `//` or `#` the JS masker would misread), and {@link configPatternRule}: ONE rule
 * per `insecureConfig` registry key.
 *
 * Each `insecureConfig` key is matched in ONE memoized pass per view ({@link insecureConfigHits}). Built-in
 * patterns run over the whole text (`gm`, combined); repo-added ones line by line, capped (`registryHits`).
 */

import type { DeltaRule, RuleFinding, RuleInput, Severity } from '../../contract.js';
import { DEFAULT_REGISTRIES } from '../../registry/defaults.js';
import { isCodePath, isSnapshotPath, isTestPath, squash, type TextView } from './files.js';
import { registryHits, registryPatterns, stateSides, type Hit } from './stateRule.js';

export const isWorkflowPath = (p: string): boolean => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(p);
export const isDockerfilePath = (p: string): boolean => /(^|\/)(Dockerfile|Containerfile)(\.[^/]+)?$/.test(p) || /\.dockerfile$/i.test(p);
export const isComposePath = (p: string): boolean => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i.test(p);
export const isWranglerPath = (p: string): boolean => /(^|\/)wrangler\.(toml|jsonc?)$/.test(p);

/** Any non-test, non-doc file: code, config, headers, HTML. */
export const isSurfacePath = (p: string): boolean => !isTestPath(p) && !isSnapshotPath(p) && !/\.(md|mdx|txt|rst|adoc)$/i.test(p);

/** A config named for a non-production environment (or a template of one): never a production config. */
const NON_PROD_NAME = /(^|[/._-])(dev|development|local|test|testing|override|example|sample|template)([/._-]|$)/i;

/** A production deploy / runtime config: wrangler, Docker, compose, `.env.production`, or a `prod`-named config file. */
export function isProdConfigPath(p: string): boolean {
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (NON_PROD_NAME.test(base)) return false;
    if (isWranglerPath(p) || isDockerfilePath(p) || isComposePath(p)) return true;
    if (/^\.env\.prod/i.test(base)) return true;
    return /(^|[/._-])prod(uction)?([/._-]|$)/i.test(p) && /\.(json|jsonc|ya?ml|toml|ini|conf|cfg|properties|env)$/i.test(base);
}

/** The text a config rule scans on one side. */
export const scanText = (view: TextView): string => (isCodePath(view.path) ? view.code : view.text);

const hitOf = (offset: number, match: RegExpExecArray): Hit => ({ offset, length: match[0].length, key: squash(match[0]).slice(0, 60) });

/**
 * One `insecureConfig` key's hits on one side, memoized per view and key: ONE combined pass over the
 * key's vetted patterns (each skipped outright when its mandatory literal is absent). Per key, not all
 * keys at once, so a key is only ever matched in the files its rule reads (`debug-enabled` never scans
 * a `.ts` file) and `cors-credentials` only where `cors-permissive` hit.
 */
export function insecureConfigHits(view: TextView, input: RuleInput, key: string): readonly Hit[] {
    return view.memo(`insecureConfig:${key}`, () => {
        const sources = input.registries.insecureConfig[key] ?? [];
        if (sources.length === 0) return [];
        const patterns = registryPatterns(sources, DEFAULT_REGISTRIES.insecureConfig[key] ?? []);
        return registryHits(patterns, scanText(view), view.lineStarts()).map(({ offset, match }) => hitOf(offset, match));
    });
}

export interface ConfigPatternSpec {
    id: string;
    severity: Severity;
    files(path: string): boolean;
    /** Drops hits the patterns cannot rule out alone (e.g. `debug-enabled` in a non-prod wrangler env table). */
    keep?(view: TextView, hit: Hit): boolean;
}

/** A rule whose findings are the `insecureConfig[id]` pattern hits in its files. */
export function configPatternRule(spec: ConfigPatternSpec): DeltaRule {
    const rule: DeltaRule = {
        id: spec.id,
        version: 1,
        dimension: 'security',
        reads: ['content'],
        derive(input): { before: RuleFinding[]; after: RuleFinding[] } {
            if ((input.registries.insecureConfig[spec.id] ?? []).length === 0) return { before: [], after: [] };
            return stateSides(rule, {
                files: spec.files,
                hits: (view) => {
                    const hits = insecureConfigHits(view, input, spec.id);
                    return spec.keep ? hits.filter((h) => spec.keep!(view, h)) : [...hits];
                },
                severity: spec.severity,
            }, input);
        },
    };
    return rule;
}
