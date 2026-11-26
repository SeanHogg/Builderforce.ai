/**
 * The fixed requests the Simulate drawer sends to the agent: run the path for real, or save it as
 * a test file. Pure; the file name is derived from the path, never from a model.
 */

import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import type { PathModel } from '../path';

/** `users-service-repository.test.ts` from the stops: lowercase, dashes, capped. */
export function testFileName(path: PathModel): string {
    const base = path.stops.map((s) => s.name).join(' ').toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
    return `${slug || 'path'}.test.ts`;
}

export function valuesText(values: Readonly<Record<string, string>>, none: string): string {
    const parts = Object.entries(values).map(([k, v]) => `${k}=${v}`);
    return parts.length > 0 ? parts.join(', ') : none;
}

export function runRequest(path: PathModel, values: Readonly<Record<string, string>>, labels: KnowledgeGraphLabels): string {
    const t = labels.surface.simulate;
    return fillTemplate(t.requestText, { path: path.stops.map((s) => s.name).join(' → '), values: valuesText(values, t.noValues) });
}

export function saveTestRequest(path: PathModel, values: Readonly<Record<string, string>>, stubs: readonly string[], labels: KnowledgeGraphLabels): string {
    const t = labels.surface.simulate;
    return fillTemplate(t.saveTestText, {
        file: testFileName(path), path: path.stops.map((s) => s.name).join(' → '),
        values: valuesText(values, t.noValues), stubs: stubs.length > 0 ? stubs.join(', ') : t.noStubs,
    });
}
