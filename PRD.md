> **PRD** — drafted by Coder Agent (V2) (Durable) · task #67
> _Each agent that updates this PRD signs its change below._

# PRD: Remove `googleai/gemini-2.5-flash-lite` Model

## Problem & Goal

The `googleai/gemini-2.5-flash-lite` model has been identified as performing poorly and producing "garbage" output. The goal of this task is to completely remove all references and integrations of this model from the codebase to prevent its further use and reliance.

## Target Users / ICP Roles

*   **Engineering Teams:** Responsible for code maintenance, deployment, and integration of LLM models.
*   **Product Managers:** Overseeing the quality and performance of AI-powered features.
*   **QA Teams:** Verifying that the problematic model is no longer accessible or being utilized.

## Scope

This effort includes identifying and removing all instances where the `googleai/gemini-2.5-flash-lite` model is:

*   Specified in configuration files.
*   Called or referenced in the codebase.
*   Used in any automated testing or CI/CD pipelines.
*   Included in any documentation or example code.

## Functional Requirements

1.  **Codebase Scan:** Perform a comprehensive scan of the entire codebase to locate all occurrences of `googleai/gemini-2.5-flash-lite`.
2.  **Model Removal:** Remove all direct references to `googleai/gemini-2.5-flash-lite`.
3.  **Configuration Update:** Update all configuration files that specify `googleai/gemini-2.5-flash-lite` as a default or available model.
4.  **Testing & Validation:** Ensure that no tests or CI/CD pipelines attempt to use or configure this model.
5.  **Documentation Update:** Remove any mentions of `googleai/gemini-2.5-flash-lite` from user-facing and internal documentation.

## Acceptance Criteria

*   A code review confirms that all explicit references to `googleai/gemini-2.5-flash-lite` have been removed from the codebase.
*   All relevant configuration files no longer list `googleai/gemini-2.5-flash-lite` as an option.
*   Automated tests that previously interacted with this model now either use an alternative or are updated to reflect the model's absence.
*   CI/CD pipelines run successfully without errors related to the `googleai/gemini-2.5-flash-lite` model.
*   Documentation (internal and external) is updated to reflect the removal.
*   A final search of the codebase and configurations yields no results for `googleai/gemini-2.5-flash-lite`.

## Out of Scope

*   Evaluating or integrating alternative LLM models.
*   Performance testing of any other LLM models.
*   Modifying user interfaces or user-facing features that might have previously been powered by this model (unless directly tied to its configuration).
*   Addressing any underlying infrastructure issues that might have contributed to the model's poor performance (focus is solely on removal).