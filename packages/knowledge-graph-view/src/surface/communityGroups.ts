/**
 * Stations by cohesion (PRD 38 P1): the communities memory's Louvain found over the file reference graph.
 *
 *   - A file the packs gave no area (and that is not repo config) stands in its community's station,
 *     `community:<id>`, named by the community's table label (else the localized `communityFallback`),
 *     instead of its top-level folder. Only a file with no community stays on the folder fallback.
 *   - Past MAX_STATIONS, grouping by community REPLACES the directory roll-up whenever the communities
 *     (plus the repo-config, folder and area leftovers that have no community) fit under the cap;
 *     otherwise the directory roll-up (`rollUpAreas`) still runs.
 *
 * Community ids are per build, so a `community:` station id is only meaningful inside the graph it came from.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { communityIdOf, communityKey, communityName } from '../placement';
import { MAX_STATIONS, rollUpAreas, type Group } from './areaRollup';

/** The ONE station of top-level config files (LICENSE, Dockerfile, dotfiles, root docs). */
export const REPO_CONFIG_STATION_ID = 'folder:repo-config';

/** A community's station name by id. */
export type CommunityName = (id: number) => string;

/** A graph's community names (`communityName`): the table label, else `fallback` (the host's `labels.communityFallback`; English when absent). */
export function communityNamer(graph: KnowledgeGraph, fallback?: string): CommunityName {
    return (id) => communityName(graph, id, fallback);
}

/** A file's community station (id and name); undefined when it has no community. */
export function communityGroupOf(n: Pick<KNode, 'badges'>, nameOf: CommunityName): { id: string; name: string } | undefined {
    const id = communityIdOf(n);
    return id === undefined ? undefined : { id: communityKey(id), name: nameOf(id) };
}

/**
 * The groups regrouped by community: every file with a community moves to its community's station;
 * repo config and files with no community keep their group. Null when the result would still exceed
 * `cap`, or when no file has a community (nothing to group by).
 */
export function groupByCommunity(groups: ReadonlyMap<string, Group>, nameOf: CommunityName, cap = MAX_STATIONS): Map<string, Group> | null {
    const out = new Map<string, Group>();
    let any = false;
    for (const g of groups.values()) {
        for (const n of g.nodes) {
            const community = g.id === REPO_CONFIG_STATION_ID ? undefined : communityIdOf(n);
            const id = community === undefined ? g.id : communityKey(community);
            let into = out.get(id);
            if (!into) {
                // Named once per station, never per file.
                into = community !== undefined ? { id, name: nameOf(community), kind: 'community', nodes: [] } : { id, name: g.name, kind: g.kind, nodes: [] };
                out.set(id, into);
            }
            if (community !== undefined) any = true;
            into.nodes.push(n);
        }
    }
    return any && out.size <= cap ? out : null;
}

/** Keeps the station count under the cap: by community when they fit, else the directory roll-up. Under the cap, the groups unchanged. */
export function foldGroups(groups: Map<string, Group>, areaName: (id: string) => string, communityName: CommunityName, cap = MAX_STATIONS): Map<string, Group> {
    if (groups.size <= cap) return groups;
    return groupByCommunity(groups, communityName, cap) ?? rollUpAreas(groups, areaName, cap);
}
