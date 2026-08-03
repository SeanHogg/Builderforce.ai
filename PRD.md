> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1433
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Current resource estimation provides a combined view of required resources without distinguishing between human and AI contributions. This lack of granularity makes it difficult for project managers and team leads to accurately plan, allocate budgets, and assess the feasibility of projects.

### Goal
Extend the existing resource estimation functionality to provide a detailed breakdown of required resources, differentiating between human Full-Time Equivalents (FTEs) by skill/role and AI agent types/hours with token budgets. This will enable more precise planning, budgeting, and resource allocation.

## Target Users / ICP Roles

- **Project Managers**: To accurately plan and allocate resources.
- **Team Leads**: To understand the skill and AI requirements for their projects.
- **Finance Teams**: To budget for both human and AI resources.
- **AI Strategists**: To assess AI needs and token budgets.

## Scope

### In-Scope
- Modify the resource estimation API to include separate breakdowns for human FTEs and AI agent types.
- Define and implement the structure for AI agent types, including hours and token budgets.
- Update the API response to include the new resource breakdown.
- Ensure backward compatibility with existing resource estimation calls.
- Add unit tests to validate the new resource breakdown functionality.

### Out-of-Scope
- UI changes to display the new resource breakdown.
- Integration with AI token billing systems.
- Modification of the data ingestion pipeline for AI agent types.
- Support for real-time AI token usage tracking.

## Functional Requirements

1. **API Modification**
   - Extend the `api/src/application/insights/resourceEstimation.ts` to include separate fields for human FTEs and AI agent types.
   - Define a new structure for AI agent types that includes:
     - Agent type identifier
     - Estimated hours required
     - Token budget

2. **Resource Breakdown Structure**
   - Human Resources:
     - List of skills/roles
     - FTE count per skill/role
   - AI Resources:
     - List of AI agent types
     - Hours per AI agent type
     - Token budget per AI agent type

3. **API Response Update**
   - Modify the API response to include the new resource breakdown structure.
   - Ensure the response is in JSON format and follows the defined schema.

4. **Backward Compatibility**
   - Ensure that existing clients of the resource estimation API are not affected by the changes.
   - Provide clear documentation for clients to update their implementations if necessary.

5. **Unit Testing**
   - Implement unit tests to validate the correctness of the new resource breakdown functionality.
   - Test cases should cover:
     - Standard resource estimation scenarios
     - Edge cases with minimal and maximal resource requirements
     - Validation of AI token budgets

## Acceptance Criteria

- The resource estimation API returns a detailed breakdown of human FTEs by skill/role and AI agent types/hours with token budgets.
- The API response structure is well-defined and documented.
- Existing clients of the API continue to function without errors after the update.
- Unit tests cover all functional requirements and pass consistently.
- The implementation does not introduce performance regressions in the resource estimation process.

## Out of Scope

- UI changes to display the new resource breakdown.
- Integration with AI token billing systems.
- Modification of the data ingestion pipeline for AI agent types.
- Support for real-time AI token usage tracking.
- Handling of concurrent resource estimation requests with the new breakdown.

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