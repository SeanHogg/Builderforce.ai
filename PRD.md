> **PRD** — drafted by Product Manager · task #518
> _Each agent that updates this PRD signs its change below._

# WIP PRD: Job Category Taxonomy & Advanced Search/Filters - Design Layer

## Problem & Goal
Current job search lacks a standardized, hierarchical category taxonomy, leading to inconsistent results and limited filtering. Goal: Define a design layer for taxonomy structures and advanced filter types (per PRD #380) to enable precise, scalable search including optional discipline filters. This reduces follow-up implementation friction and supports iterative taxonomy evolution.

## Target Users / ICP Roles
- Job seekers (primary): Need intuitive category-based discovery and refinement.
- Recruiters / hiring managers: Require taxonomy-aligned posting and candidate filtering.
- Platform admins: Manage taxonomy updates and filter configurations.

## Scope
- Design taxonomy hierarchy (categories, subcategories) and filter component types.
- Incorporate optional discipline filter handling as a modular extension.
- Document follow-up ticket steps for engineering handoff.
- Exclude: Backend implementation, data migration, or full UI build.

## Functional Requirements
- Taxonomy supports 3-level hierarchy with unique IDs and labels.
- Advanced filters include multi-select, hierarchical dropdowns, and range sliders for relevant attributes.
- Discipline filter is optional, toggleable via config flag, and integrates with core category taxonomy.
- Search results update dynamically based on selected taxonomy nodes and filters.
- Provide exportable schema definitions for downstream consumption.

## Acceptance Criteria
- Taxonomy schema validated against sample job dataset with 95% coverage.
- Filter types render correctly in design mocks for desktop and mobile.
- Optional discipline filter demonstrates toggle behavior without breaking core flow.
- Follow-up tickets listed with clear owners, priorities, and dependencies.
- All requirements traceable to PRD #380 sections.

## Out of Scope
- Production data population or taxonomy seeding.
- Performance testing or analytics integration.
- Mobile app native implementation.
- User-facing copy or localization.

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