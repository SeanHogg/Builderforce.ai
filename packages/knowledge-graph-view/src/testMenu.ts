/**
 * Test helper (not shipped): the header's ⋯ menu is where "Review a folder" lives now. Like
 * `openList`, it takes testing-library injected so this module imports none.
 */
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';

export interface MenuDeps {
    screen: {
        findByRole(role: 'button', options: { name: string }): Promise<Element>;
        getByRole(role: 'menu', options: { name: string }): HTMLElement;
    };
    fireEvent: { click(element: Element): unknown };
}

/** Opens ⋯ More actions and returns the menu. */
export async function openMore({ screen, fireEvent }: MenuDeps): Promise<HTMLElement> {
    fireEvent.click(await screen.findByRole('button', { name: L.surface.header.moreActions }));
    return screen.getByRole('menu', { name: L.surface.header.moreActions });
}

/** Presses a ⋯ menu item whose name starts with `name`. */
export async function pressMore(deps: MenuDeps, name: string): Promise<void> {
    const menu = await openMore(deps);
    const item = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => el.textContent?.startsWith(name));
    if (!item) throw new Error(`No ⋯ item named ${name}`);
    deps.fireEvent.click(item);
}
