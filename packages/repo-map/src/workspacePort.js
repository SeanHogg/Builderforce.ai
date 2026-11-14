/**
 * The repo map as a PORT for hosts that read a workspace through their own file access
 * (`@builderforce/agent-tools/knowledge`'s `RepoGraphPort`, restated structurally — agent-tools
 * may not import this package, which imports it): the editor, on-prem and the PreFetch
 * code-pack executors feed the map's `references` edges into the knowledge graph with it.
 */
import { isMapCandidate } from './filePolicy.js';
import { RepoGraphBuilder } from './repoGraph.js';
export const repoMapPort = {
    create: () => new RepoGraphBuilder(),
    accepts: (path, size) => isMapCandidate(path, size),
};
//# sourceMappingURL=workspacePort.js.map