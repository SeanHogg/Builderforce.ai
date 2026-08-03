> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1629
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) - Fix: Wrong Repository Bound for Task #528

## Problem & Goal
### Problem
Task #528 is currently assigned to the `seanhogg/builderforce.ai` repository, which is an agent-runtime workspace with no frontend code (e.g., `attentionApi.ts`, `DashboardWithAttentionItems.tsx`, `Top10AttentionItems`). This mismatch causes confusion and prevents the task from being completed as intended.

### Goal
Resolve the repository binding issue for task #528 by either:
1. Redirecting the task to the correct repository containing the necessary frontend code.
2. Adding the required frontend code to the `seanhogg/builderforce.ai` repository.

## Target Users / ICP Roles
- **Developers**: Individuals working on frontend and backend integration tasks.
- **Project Managers**: Responsible for task assignment and tracking.
- **Repository Administrators**: In charge of managing repository access and content.

## Scope
- Identify the correct repository containing the frontend code for task #528.
- Update the task assignment to the correct repository.
- Alternatively, add the missing frontend code to the `seanhogg/builderforce.ai` repository.
- Ensure that the task description and associated metadata are updated to reflect the changes.

## Functional Requirements
1. **Repository Identification**
   - Locate the repository that contains the frontend code (`attentionApi.ts`, `DashboardWithAttentionItems.tsx`, `Top10AttentionItems`).
   - Verify that the repository is accessible to the team members assigned to task #528.

2. **Task Reassignment**
   - Update the task assignment in the project management tool to reflect the correct repository.
   - Notify all relevant stakeholders of the change.

3. **Code Addition (if applicable)**
   - Add the missing frontend code to the `seanhogg/builderforce.ai` repository.
   - Ensure that the added code is compatible with the existing codebase and follows the project's coding standards.

4. **Documentation Update**
   - Update the task description and any related documentation to include the correct repository information.
   - Provide clear instructions for accessing and working with the frontend code.

5. **Communication**
   - Send a notification to all team members and stakeholders affected by the change.
   - Include details on the changes made and any actions required on their part.

## Acceptance Criteria
- Task #528 is correctly assigned to the repository containing the necessary frontend code.
- The frontend code is present in the `seanhogg/builderforce.ai` repository if that option is chosen.
- All stakeholders are informed of the changes and understand the new repository binding.
- The task description and associated metadata are updated to reflect the correct repository information.
- The added code (if applicable) is reviewed and approved by the repository administrator.

## Out of Scope
- Modifying the functionality of the frontend code itself.
- Addressing any issues related to the implementation of the frontend code in task #528.
- Changes to other tasks or repositories not directly related to task #528.
- Training or onboarding activities for team members on the new repository structure.

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