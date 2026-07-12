/**
 * Taxonomy utilities for advanced search & filters (PRD #380)
 * Provides list, tree, and lookup operations for job-category-taxonomy.json
 * These helpers are ready to integrate with jobs/freelancers tables once schema exists.
 */

import { category as TaxonomyData } from "./job-category-taxonomy.json";

export type TaxonomySkill = (typeof TaxonomyData.categories)[number]["skills"][number];

/**
 * Full category/skill descriptor with hierarchy and computed metadata
 */
export interface TaxonomyNode {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  isCategory: boolean;
  tags: string[];
  depth: number; // 0 for root categories, >0 for any skill
  orderMeta: number;
  skills?: TaxonomySkill[]; // only present for categories
  preferredDuration?: { minWeeks?: number; maxWeeks?: number; minMonths?: number; maxMonths?: number; minYears?: number };
}

/**
 * Get all categories and skills as a flat collection of nodes
 */
export function listAllTaxonomy(): TaxonomyNode[] {
  const nodes: TaxonomyNode[] = [];

  for (const cat of TaxonomyData.categories) {
    nodes.push({
      id: cat.id,
      name: cat.name,
      parentId: cat.parentId,
      description: cat.description,
      isCategory: true,
      tags: cat.tags,
      depth: 0,
      orderMeta: cat.orderMeta,
      skills: cat.skills || []
    });

    if (cat.skills) {
      for (const skill of cat.skills) {
        nodes.push({
          id: skill.id,
          name: skill.name,
          parentId: skill.parentId,
          description: skill.description,
          isCategory: false,
          tags: skill.tags,
          depth: 1 + (Array.from(findParentIds(skill.id)).length), // depth = descendants + 1
          orderMeta: skill.orderMeta || 0,
          preferredDuration: skill.preferredDuration
        });
      }
    }
  }

  return nodes;
}

/**
 * Find parent IDs chain for a skill
 */
function findParentIds(skillId: string): Set<string> {
  const result = new Set<string>();
  const allSkills = getSkillMap();

  let current = allSkills.get(skillId);
  while (current?.parentId) {
    result.add(current.parentId);
    current = allSkills.get(current.parentId);
  }
  return result;
}

/**
 * Get a single skill by ID (including parent categories)
 */
export function getSkillById(skillId: string): TaxonomySkill | null {
  for (const cat of TaxonomyData.categories) {
    if (cat.skills) {
      const found = cat.skills.find((s) => s.id === skillId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get a map of all skills keyed by ID for O(1) lookup
 */
function getSkillMap(): Map<string, TaxonomySkill> {
  const map = new Map<string, TaxonomySkill>();
  for (const cat of TaxonomyData.categories) {
    cat.skills?.forEach((skill) => map.set(skill.id, skill));
  }
  return map;
}

/**
 * Get category by ID
 */
export function getCategoryById(categoryId: string) {
  return TaxonomyData.categories.find((c) => c.id === categoryId) || null;
}

/**
 * Get skills by category ID
 */
export function getSkillsByCategory(categoryId: string): TaxonomySkill[] {
  for (const cat of TaxonomyData.categories) {
    if (cat.id === categoryId) {
      return cat.skills || [];
    }
  }
  return [];
}

/**
 * Build category hierarchy with skills flattened into a tree of TaxonomyNode
 */
export function getTaxonomyTree(): TaxonomyNode[] {
  const allSkills = getSkillMap();

  return TaxonomyData.categories.map((cat) => {
    const node: TaxonomyNode = {
      id: cat.id,
      name: cat.name,
      parentId: cat.parentId,
      description: cat.description,
      isCategory: true,
      tags: cat.tags,
      depth: 0,
      orderMeta: cat.orderMeta,
      skills: (cat.skills || []).map((skill) => {
        const parentIds = findParentIds(skill.id);
        // Compute depth: 1 (self) + number of parents
        const depth = 1 + parentIds.size;
        return {
          id: skill.id,
          name: skill.name,
          parentId: skill.parentId,
          description: skill.description,
          tags: skill.tags,
          depth,
          orderMeta: skill.orderMeta || 0,
          preferredDuration: skill.preferredDuration
        };
      })
    };
    return node;
  });
}

/**
 * Get all taxonomy categories (roots only)
 */
export function getAllCategories() {
  return TaxonomyData.categories;
}

/**
 * Legacy helper for discipline-only deployments (pre-taxonomy)
 */
export function legacyDisciplineExtractor(record: any): string[] {
  const disciplines: string[] = [];
  if (typeof record.discipline === "string") {
    disciplines.push(record.discipline);
  } else if (Array.isArray(record.discipline)) {
    disciplines.push(...record.discipline);
  }
  return disciplines;
}

/**
 * Utility to promote a newly added skill into a dataset
 *
 * @param nodeId — skill id from the taxonomy
 * @param datasetKey — "jobs" | "freelancers"
 * @param fn — (taxNode) => any to add or express interest in the skill via a model-compatible field
 */
export function promoteSkillToDataset(nodeId: string, datasetKey: string, fn: (taxNode: TaxonomyNode) => any) {
  const nodes = listAllTaxonomy();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`Skill not found in taxonomy: ${nodeId}`);
  }
  // placeholder for migration
  const migrated = fn(node);
  console.log(`[Taxonomy] Promoted skill ${nodeId} to dataset ${datasetKey}:`, migrated);
  return migrated;
}