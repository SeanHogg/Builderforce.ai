/**
 * Test helpers for the controls the scene overlay and the Act rail own: the View group (a
 * segmented radio group), the lenses (which live in the question pills and the More questions
 * menu: there is no lens row) and the Act rail's collapsed Details section. They read the DOM
 * directly rather than through role queries, which are slow over a whole view. Not a test file
 * and not exported from the package. Like `testing.ts` it imports no testing library (this
 * module is not a test file, so the package graph would count it as a runtime import): the
 * suite injects `fireEvent`.
 */

import type { KnowledgeGraphLabels } from './labels';
import { PRIMARY_QUESTIONS, questionForLens } from './surface/questions';
import type { LensId } from './types';

/** The slice of testing-library the helpers use. */
export interface PickDeps {
    fireEvent: {
        click(element: Element): unknown;
        keyDown(element: Element, init: { key: string }): unknown;
    };
}

const all = (selector: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(selector)];

/** Switches the camera (the View group is a radio group, one radio per camera). */
export function pickCamera({ fireEvent }: PickDeps, name: string): void {
    const radio = all('[role="radio"]').find((r) => r.textContent === name);
    if (!radio) throw new Error(`no camera named ${name}`);
    fireEvent.click(radio);
}

/** Opens the Act rail's Details section (Insights and the Lens panel) so its contents are visible to role queries. */
export function openDetails({ fireEvent }: PickDeps): void {
    const toggle = document.querySelector<HTMLElement>('[data-testid="kg-act-details-toggle"]');
    if (!toggle) throw new Error('the Act rail has no Details section');
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');

/** The More questions trigger: it reads "More questions", or the picked question's name while one under it is active. */
function moreTrigger(labels: KnowledgeGraphLabels): HTMLElement {
    const names = new Set<string>([labels.surface.moreQuestions, ...Object.values(labels.surface.questions), ...Object.values(labels.lenses)]);
    const found = all('button[aria-haspopup="menu"]').find((b) => names.has((b.textContent ?? '').replace(/\s*▾$/, '').trim()));
    if (!found) throw new Error('the More questions menu is not on screen');
    return found;
}

function openMore({ fireEvent }: PickDeps, labels: KnowledgeGraphLabels): void {
    if (!menu()) fireEvent.click(moreTrigger(labels));
}

const item = (id: string) => document.querySelector<HTMLElement>(`[role="menuitem"][data-item="${id}"]`);
const pill = (q: string) => document.querySelector<HTMLElement>(`button[data-question="${q}"]`);
const isPrimary = (q: ReturnType<typeof questionForLens>): q is NonNullable<typeof q> => q !== undefined && PRIMARY_QUESTIONS.some((p) => p.id === q);

/** Does what the old lens chip did: picks the lens through its question pill, or its More-menu item. */
export function pickLens(deps: PickDeps, labels: KnowledgeGraphLabels, id: LensId): void {
    const q = questionForLens(id);
    if (isPrimary(q)) {
        const el = pill(q);
        if (!el) throw new Error(`no pill for question ${q}`);
        deps.fireEvent.click(el);
        return;
    }
    openMore(deps, labels);
    const target = item(q ?? `lens:${id}`);
    if (!target) throw new Error(`no menu item for lens ${id}`);
    deps.fireEvent.click(target);
}

/** Whether the lens is the one picked: its question pill is pressed, or its More item is the selected one. */
export function lensIsPicked(deps: PickDeps, labels: KnowledgeGraphLabels, id: LensId): boolean {
    const q = questionForLens(id);
    if (isPrimary(q)) return pill(q)?.getAttribute('aria-pressed') === 'true';
    openMore(deps, labels);
    const picked = item(q ?? `lens:${id}`)?.getAttribute('data-selected') === 'true';
    const open = menu();
    if (open) deps.fireEvent.keyDown(open, { key: 'Escape' });
    return picked;
}
