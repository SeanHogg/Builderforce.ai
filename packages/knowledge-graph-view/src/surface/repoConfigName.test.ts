// @vitest-environment node
/** The "repo config" station's name is a label: the English default, each host catalog's own words, and the station model uses what it is given. */
import { describe, expect, it } from 'vitest';
import de from '../../../../frontend/src/i18n/messages/de.json?raw';
import en from '../../../../frontend/src/i18n/messages/en.json?raw';
import es from '../../../../frontend/src/i18n/messages/es.json?raw';
import fr from '../../../../frontend/src/i18n/messages/fr.json?raw';
import zh from '../../../../frontend/src/i18n/messages/zh.json?raw';
import { resolveLabels } from '../labels';
import { surfaceFixture } from '../testing';
import { REPO_CONFIG_NAME } from './stationName';
import { buildStations } from './stations';

const CATALOGS: Record<string, string> = { en, zh, es, fr, de };
const catalog = (locale: string): { knowledgeGraph: { surface: { repoConfig?: string } } } => JSON.parse(CATALOGS[locale]!);

/** The surface fixture plus a LICENSE at the repo's top level: the one file that lands in the config station. */
function withLicense() {
    const graph = surfaceFixture();
    const job = graph.nodes.find((n) => n.ref === 'src:sys::cron/job.ts')!;
    return { ...graph, nodes: [...graph.nodes, { ...job, ref: 'src:sys::LICENSE' as typeof job.ref, label: 'LICENSE' }] };
}
const configStation = (name?: string) => buildStations(withLicense(), name ? { repoConfigName: name } : {}).stations.find((s) => s.id === 'folder:repo-config')!;

describe('the repo-config station name', () => {
    it('is a label whose English default is the station\'s constant', () => {
        expect(resolveLabels().surface.repoConfig).toBe(REPO_CONFIG_NAME);
        expect(resolveLabels({ surface: { ...resolveLabels().surface, repoConfig: 'Konfiguration' } }).surface.repoConfig).toBe('Konfiguration');
    });

    it('names the station by the label the host passes, and by the English default when it passes none', () => {
        expect(configStation().name).toBe('repo config');
        expect(configStation('Repo-Konfiguration').name).toBe('Repo-Konfiguration');
    });

    it('has a real translation in each of the five catalogs', () => {
        const words = ['en', 'zh', 'es', 'fr', 'de'].map((locale) => catalog(locale).knowledgeGraph.surface.repoConfig);
        expect(words[0]).toBe('repo config');
        expect(words.every((w) => typeof w === 'string' && w.length > 0)).toBe(true);
        expect(new Set(words).size).toBe(5);
    });
});
