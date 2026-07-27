> **PRD** — drafted by Validator · task #864
> _Each agent that updates this PRD signs its change below._

# PRD: Integrate visual priority indicators (PriorityBadge) into all task views

## Problem & Goal
Task views lack consistent visual priority indicators, forcing users to scan text or metadata to understand urgency. The goal is to deliver a unified PriorityBadge component and integrate it across List, Kanban, and Detail views to provide immediate, color-coded priority visibility while maintaining design consistency with PriorityAlignmentDashboard.

## Target users / ICP roles
- Project managers
- Engineering leads
- Task assignees in Builderforce.ai

## Scope
- Create reusable PriorityBadge component (Badge, Dot, Icon, Header variants) with color coding, sizing, and helper components (PriorityBadgeList, PriorityBadgeColumn)
- Integrate PriorityBadge into TaskListView, TaskKanbanView, and TaskDetailView
- Define shared Task TypeScript interface
- Provide barrel exports, usage examples, and supporting styles
- Ensure all views reuse the component for 100% visual consistency and immediate priority updates

## Functional requirements
FR1: Implement PriorityBadge.tsx supporting four variants, three scales, and High/Medium/Low color mapping.  
FR2: Integrate PriorityBadge into TaskListView row layout with selection and responsive grid states.  
FR3: Add PriorityBadge (dot variant) to TaskKanbanView card headers across all five columns.  
FR4: Display prominent header and icon PriorityBadge variants in TaskDetailView alongside subtasks and progress.  
FR5: Export all components and types via index.ts with comprehensive CSS variables for theming and animations.

## Acceptance criteria
AC1: PriorityBadge renders correctly in all three task views.  
AC2: Color coding and scale variants match specification.  
AC3: Helper components (List/Column) function without errors.  
AC4: Visual indicators are 100% consistent across views.  
AC5: Priority changes trigger immediate badge updates.  
AC6: Implementation follows existing PriorityAlignmentDashboard patterns.

## Out of scope
- Drag-and-drop functionality in Kanban
- Backend priority persistence logic
- Additional task views (Calendar, Timeline)
- Mobile-specific layouts beyond responsive grid
- Automated tests or Storybook stories

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