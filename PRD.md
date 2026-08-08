> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1376
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Remove Governance-Only Taxonomy Placeholder Files

### Problem & Goal
**Problem:**  
The placeholder files `Job-category-taxonomy.json` and `filter-types.ts` were created as temporary placeholders for task #519 governance alignment and task #380 GAP P2-11. These files are not intended for production and should not be included in the codebase.

**Goal:**  
Remove the placeholder files to prevent unintended inclusion in the production codebase and ensure that only relevant and necessary files are maintained.

### Target Users / ICP Roles
- **Developers:** Responsible for implementing the removal of the placeholder files.
- **Code Reviewers:** Ensure the removal is correctly executed and does not affect other parts of the codebase.
- **Product Managers:** Verify that the removal aligns with the product roadmap and does not introduce any gaps.

### Scope
- **In Scope:**
  - Removal of the following files:
    - `api/src/application/governance/reference/Job-category-taxonomy.json`
    - `api/src/application/governance/filter-types.ts`
  - Update of any references or imports to these files in the codebase.
  - Documentation of the removal in the project's change log.
  - Verification that the removal does not break existing functionality.

- **Out of Scope:**
  - Modification of other files or components not directly related to the placeholder files.
  - Creation of new taxonomy or filter type files (this is a separate task).
  - Deployment of the changes (handled by the DevOps team).

### Functional Requirements
1. **File Removal:**
   - Remove `Job-category-taxonomy.json` from `api/src/application/governance/reference/`.
   - Remove `filter-types.ts` from `api/src/application/governance/`.

2. **Reference Update:**
   - Identify and update all references and imports to the removed files in the codebase.
   - Ensure that any dependent components are updated to handle the absence of these files gracefully.

3. **Testing:**
   - Implement unit tests to verify that the removal does not affect existing functionality.
   - Conduct integration tests to ensure that the system behaves as expected without the placeholder files.

4. **Documentation:**
   - Update the project's documentation to reflect the removal of the files.
   - Add a note to the change log detailing the removal and its purpose.

### Acceptance Criteria
- The files `Job-category-taxonomy.json` and `filter-types.ts` are completely removed from the codebase.
- All references and imports to these files are updated or removed as necessary.
- No build or runtime errors are introduced due to the removal of the files.
- Unit and integration tests pass successfully after the removal.
- The change is documented in the project's change log.
- The removal is communicated to relevant stakeholders.

### Out of Scope
- Modification of other files or components not directly related to the placeholder files.
- Creation of new taxonomy or filter type files.
- Deployment of the changes (handled by the DevOps team).
- Handling of any potential merge conflicts or issues arising from the removal (to be managed by the development team during implementation).

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

## Acceptance

_Owned by the validator — to be authored._