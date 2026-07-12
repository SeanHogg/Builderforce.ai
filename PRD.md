> **PRD** — drafted by Ada (Sr. Product Mgr) · task #380
> _Each agent that updates this PRD signs its change below._

# Job Category Taxonomy & Advanced Search/Filters

## Problem & Goal

**Problem:** The current job posting and freelancer search functionality is limited, primarily relying on a single `discipline` filter. This hinders effective matching between job opportunities and qualified freelancers, leading to a less efficient marketplace.

**Goal:** To enhance the job and freelancer marketplace by introducing a comprehensive job category taxonomy and advanced faceted search capabilities. This will enable users to more precisely discover relevant opportunities and talent based on specific skills, budget, duration, and experience levels.

## Target Users / ICP Roles

*   **Employers/Hiring Managers:** Seeking to efficiently find freelancers with specific skills and qualifications.
*   **Freelancers:** Looking for job opportunities that align with their skills, experience, and desired working conditions.

## Scope

This PRD covers the development of:

1.  **Job Category Taxonomy:** A structured hierarchy for classifying job roles and skills.
2.  **Advanced Search & Filters:** Implementation of new filter options for jobs and freelancers.
3.  **Integration:** Seamless integration of the new taxonomy and filters into the existing job and freelancer search interfaces.

## Functional Requirements

1.  **Job Category Taxonomy Development:**
    *   Define a multi-level taxonomy for job categories and associated skills.
    *   The taxonomy should support hierarchical relationships (e.g., "Design" > "Graphic Design" > "Logo Design").
    *   Each category/skill should have a unique identifier and human-readable name.
    *   The taxonomy should be extensible for future additions.
2.  **Advanced Search & Filter Implementation (Jobs):**
    *   Implement a **Skills** filter based on the developed taxonomy. Users should be able to select multiple skills.
    *   Implement a **Budget Range** filter (e.g., min/max value for hourly or project-based budgets).
    *   Implement a **Duration** filter (e.g., short-term, medium-term, long-term, or specific date ranges).
    *   Implement an **Experience Level** filter (e.g., Entry-level, Mid-level, Senior, Expert).
    *   Combine these new filters with the existing `discipline` filter.
3.  **Advanced Search & Filter Implementation (Freelancers):**
    *   Implement a **Skills** filter based on the developed taxonomy. Users should be able to select multiple skills.
    *   Implement a **Budget Range** filter (e.g., min/max hourly or project rate).
    *   Implement a **Availability/Duration** filter indicating preferred project length or availability for ongoing work.
    *   Implement an **Experience Level** filter (e.g., Entry-level, Mid-level, Senior, Expert).
    *   Combine these new filters with the existing `discipline` filter.
4.  **User Interface (UI) Updates:**
    *   Design and implement intuitive UI elements for the new filters in both job and freelancer search results pages.
    *   Ensure clear visual feedback on selected filters.
    *   Provide a mechanism to easily clear all applied filters.
5.  **Backend Logic:**
    *   Develop robust backend logic to handle faceted search queries incorporating all new and existing filter criteria.
    *   Optimize search performance for a large dataset of jobs and freelancers.

## Acceptance Criteria

*   Users can successfully search for jobs and freelancers using filters for:
    *   Specific skills (from the defined taxonomy).
    *   Budget range (min and max values).
    *   Project duration (predefined categories or specific ranges).
    *   Experience level (predefined categories).
*   All new filters can be used in conjunction with the existing `discipline` filter.
*   The search results accurately reflect the applied filter criteria.
*   The UI for filters is intuitive and responsive across different devices.
*   Users can easily add and remove multiple filter selections.
*   A clear "Clear All Filters" option is available and functional.
*   Search performance remains acceptable even with multiple filters applied.

## Out of Scope

*   Development of a freelancer skills assessment or verification system.
*   Automated job/freelancer recommendation engine based on the new taxonomy.
*   Advanced natural language processing (NLP) for skill extraction from job descriptions or freelancer profiles (beyond matching against the predefined taxonomy).
*   Management of the job category taxonomy itself (e.g., an admin interface for taxonomy editing) – this is assumed to be handled by a separate process or team.
*   Real-time updating of search results as filters are applied (unless technically trivial and agreed upon during sprint planning).