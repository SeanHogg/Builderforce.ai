/**
 * prMergeAuthority — WHO may merge a pull request into a tenant's repository, as a person.
 *
 * ONE definition for the two places a person exercises that authority:
 *   - the in-product "Approve & Merge" (`POST /api/repos/pull-requests/:id/merge`), and
 *   - a merge GRANT on a cloud run (PRD 48 §4.6) — a pre-approved version of that same
 *     click, so it requires exactly the same role. A second copy of the tier is how the
 *     two would drift apart.
 *
 * DEVELOPER+: merging writes to the tenant's real repository, the same tier as every other
 * route that spends or ships.
 */
import { TenantRole } from '../../domain/shared/types';

export const PR_MERGE_MIN_ROLE = TenantRole.DEVELOPER;
