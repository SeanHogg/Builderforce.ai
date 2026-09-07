/**
 * THE keyword-match predicate for the public skill catalogue.
 *
 * It was written out twice — `marketplaceRoutes` and `publicApiRoutes` each carried
 * the same `search_vector @@ websearch_to_tsquery(q)` fragment — and both were
 * querying a column that did not exist: `marketplace_skills.search_vector` was
 * declared in schema.ts and never created by any migration, so every `?q=` search
 * on either surface failed with `column "search_vector" does not exist`. The drift
 * guard could not see it (its parser did not recognise named `customType` builders),
 * which is why it survived. Migration 1141 creates the column as GENERATED — derived
 * from the row, so there is no second writer to forget.
 *
 * One definition now, and it pins the text-search configuration. `websearch_to_tsquery(q)`
 * with no config uses the session's `default_text_search_config`; the generated column
 * uses `'english'`. Where those two disagree the index is silently useless and the
 * match is silently wrong, so both sides name the configuration.
 */

import { sql, type SQL } from 'drizzle-orm';
import { marketplaceSkills } from '../../infrastructure/database/schema';

/** The full-text configuration. Must match migration 1141's generated column. */
export const SKILL_SEARCH_CONFIG = 'english';

/** True for rows matching the visitor's query, as a SQL predicate. */
export function skillSearchMatches(query: string): SQL {
  return sql`${marketplaceSkills.searchVector} @@ websearch_to_tsquery(${SKILL_SEARCH_CONFIG}, ${query})`;
}
