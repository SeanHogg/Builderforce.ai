/**
 * The persisted `local_research` answer cache for one workspace —
 * `.builderforce/research-cache.json`, beside the symbol snapshot. ONE implementation for
 * every Node surface (`@builderforce/agent-tools/node-research`, shared with the on-prem
 * runtime); the editor names it from here so its research wiring reads in one folder.
 */

export { fileResearchStore, researchCacheStore, RESEARCH_CACHE_FILE } from "@builderforce/agent-tools/node-research";
