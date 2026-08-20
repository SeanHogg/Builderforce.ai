/**
 * WHERE a linked work item OPENS — one routing table, every surface.
 *
 * The chat⇄ticket panel renders an "Open" affordance for each item a conversation
 * created or linked. Turning `(kind, ref, projectId)` into a destination was written
 * TWICE — once in the web host (`ChatTicketsPanel`'s `openTicket`, pushing through the
 * Next router) and once in the VS Code host (`brainWebview.openArtifact`, opening an
 * external URL). The two agreed on the day they were written and then drifted, which is
 * exactly the class of duplication the repo forbids: the same decision, expressed twice,
 * with nothing making them equal.
 *
 * They also both stopped SHORT of the item. A task deep-linked to its detail drawer
 * (`&task=<id>`), but every other kind landed on the SURFACE that contains the item and
 * left the user to find the card: an objective opened the portfolio tab, a spec opened
 * the project board. "Open" that reveals a page is not opening the thing.
 *
 * So this module returns a path that names the EXACT artifact for every kind:
 *
 *   task · epic · gap   → the ticket detail drawer               (`&task=`)
 *   objective · initiative · portfolio
 *                       → the PMO Structure tab, that card focused and scrolled to
 *                                                                 (`&focus=kind:id`)
 *   spec                → the project's PRDs tab with that document's drawer open
 *                                                                 (`&panel=prds&spec=`)
 *   roadmap             → the PM Roadmap section with that item's panel open
 *                                                                 (`&section=roadmap&roadmap=`)
 *   retro · poker       → the ceremony session itself             (`&session=`)
 *
 * Framework-free on purpose (plain strings in, one path out): the web host feeds it to
 * `router.push`, the VS Code host concatenates it onto the configured web base URL, and
 * neither can be given a route the other does not have.
 */

/** Every work-item kind a Brain chat can be tied to. Mirrors `TICKET_KINDS`. */
export type ArtifactKind =
  | 'portfolio' | 'objective' | 'initiative'
  | 'roadmap' | 'spec'
  | 'epic' | 'gap' | 'task'
  | 'retro' | 'poker';

/**
 * The query param the PMO views read to focus ONE strategy card, as `kind:id`.
 * A single param (rather than `focusKind` + `focusId`) keeps the two halves
 * inseparable — a link cannot carry an id with no kind to interpret it.
 */
export const PMO_FOCUS_PARAM = 'focus';

/** Build the `focus` value for a strategy card. */
export function pmoFocusValue(kind: 'objective' | 'initiative' | 'portfolio', ref: string): string {
  return `${kind}:${ref}`;
}

/** Parse a `focus` value back into its halves; `null` for anything unrecognised. */
export function parsePmoFocus(
  value: string | null | undefined,
): { kind: 'objective' | 'initiative' | 'portfolio'; id: string } | null {
  if (!value) return null;
  const at = value.indexOf(':');
  if (at <= 0) return null;
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!id) return null;
  return kind === 'objective' || kind === 'initiative' || kind === 'portfolio' ? { kind, id } : null;
}

/**
 * The DOM id a focusable PMO card carries, so the view can scroll to it without
 * threading refs through three levels of render helper. Derived from the same
 * `kind:id` pair the URL carries, so the link and the element cannot disagree.
 */
export function pmoFocusDomId(kind: string, id: string): string {
  return `pmo-${kind}-${id}`;
}

/**
 * The path that opens ONE work item.
 *
 * `projectId` scopes the kinds that live under a project (task/epic/gap/spec/roadmap);
 * strategy tiers and ceremonies are workspace-wide and ignore it. Returns an absolute,
 * same-origin path — never a full URL, so the VS Code host stays in control of which
 * deployment it opens.
 */
export function artifactRoutePath(
  kind: string,
  ref: string | null | undefined,
  projectId?: number | null,
): string {
  const id = ref ? encodeURIComponent(ref) : '';
  const project = projectId != null ? `&project=${projectId}` : '';

  switch (kind) {
    case 'objective':
    case 'initiative':
    case 'portfolio':
      // The Structure tab is the only PMO surface that renders these as individual,
      // addressable cards — the Rollup is an aggregate, so focusing a card there is
      // meaningless. `focus` selects the tab AND the card.
      return id
        ? `/projects?tab=portfolio&${PMO_FOCUS_PARAM}=${encodeURIComponent(pmoFocusValue(kind, ref as string))}`
        : '/projects?tab=portfolio';

    case 'retro':
    case 'poker':
      // Ceremonies are workspace-wide, so no project scope rides along.
      return `/projects?tab=ceremonies&ceremony=${kind}${id ? `&session=${id}` : ''}`;

    case 'spec':
      // Specs live in the project INFORMATION panel's PRDs tab, which the projects
      // list opens as a slide-out. `spec` opens that document's own drawer.
      return projectId != null && id
        ? `/projects?project=${projectId}&panel=prds&spec=${id}`
        : projectId != null
          ? `/projects?project=${projectId}&panel=prds`
          : '/projects';

    case 'roadmap':
      // Roadmap items are rows of `roadmap_items`, rendered by the PM tab's Roadmap
      // section. `roadmap` opens that row's edit panel.
      return `/projects?tab=pm&section=roadmap${id ? `&roadmap=${id}` : ''}`;

    case 'task':
    case 'epic':
    case 'gap':
    default: {
      const base = `/projects?tab=tasks${project}`;
      return id ? `${base}&task=${id}` : base;
    }
  }
}
