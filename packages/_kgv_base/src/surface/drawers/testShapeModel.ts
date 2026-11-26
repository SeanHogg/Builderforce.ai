/**
 * The Coverage drawer's test shape: how the reviewed folder's test files split into unit,
 * integration and end-to-end. Pure over paths, so it is tested without a graph: a file is a
 * test by its NAME or a test folder, and its shape comes from path conventions (an `e2e` /
 * `playwright` / `cypress` folder or `.e2e.` name, an `integration` / `contract` folder or
 * `.integration.` / `.int.` name), else it is a unit test. A folder whose graph carries no
 * test file reports `total: 0` ("not measured"), never an invented split.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { pathOf } from '../../graphModel';

export type TestShape = 'unit' | 'integration' | 'e2e';

export const TEST_SHAPES: readonly TestShape[] = ['unit', 'integration', 'e2e'];

export interface TestShapeModel {
    unit: number;
    integration: number;
    e2e: number;
    /** Test files found; 0 ⇒ the graph holds none (not measured). */
    total: number;
}

const TEST_NAME = /(\.(test|spec)\.[cm]?[jt]sx?$)|(_test\.(go|py|rs)$)|(^test_.+\.py$)|(Tests?\.(java|kt|cs)$)|(_spec\.rb$)|(\.e2e-spec\.[jt]s$)/;
const TEST_FOLDER = /(^|\/)(__tests__|tests?|e2e|integration|specs?|cypress|playwright)\//;
const E2E_FOLDER = /(^|\/)(e2e|end-to-end|playwright|cypress)\//;
const E2E_NAME = /\.e2e(-spec)?\.|_e2e_test\./;
const INTEGRATION_FOLDER = /(^|\/)(integration|int|contract|contracts)\//;
const INTEGRATION_NAME = /\.(integration|int|it|contract)\.(test|spec)\.[cm]?[jt]sx?$|\.(integration|int|it)\.[cm]?[jt]sx?$|_integration_test\./;

/** Whether a root-relative path is a test file. */
export function isTestPath(path: string): boolean {
    const p = path.replace(/\\/g, '/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    return TEST_NAME.test(base) || (TEST_FOLDER.test(p) && /\.[cm]?[jt]sx?$|\.(py|go|rs|rb|java|kt|cs)$/.test(base));
}

/** The shape of a test file, by path convention; unit unless the path says otherwise. */
export function testShapeOf(path: string): TestShape {
    const p = path.replace(/\\/g, '/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    if (E2E_FOLDER.test(p) || E2E_NAME.test(base)) return 'e2e';
    if (INTEGRATION_FOLDER.test(p) || INTEGRATION_NAME.test(base)) return 'integration';
    return 'unit';
}

/** The split of the test files among the given paths. */
export function testShapeOfPaths(paths: Iterable<string>): TestShapeModel {
    const out: TestShapeModel = { unit: 0, integration: 0, e2e: 0, total: 0 };
    for (const path of paths) {
        if (!isTestPath(path)) continue;
        out[testShapeOf(path)] += 1;
        out.total += 1;
    }
    return out;
}

/** The split over a graph's code files. */
export function testShapeModel(graph: Pick<KnowledgeGraph, 'nodes'>): TestShapeModel {
    const paths: string[] = [];
    for (const n of graph.nodes) {
        if (n.kind !== 'file' || n.pack !== 'code') continue;
        const path = pathOf(n.ref);
        if (path) paths.push(path);
    }
    return testShapeOfPaths(paths);
}
