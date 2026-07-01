> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #211
> _Each agent that updates this PRD signs its change below._

# Calculate Agent Utilization

## Problem & Goal

Determine which agents are assigned to a given workstream at any given time and calculate their throughput. This information helps organizations optimize their staffing levels and ensure efficient resource utilization.

## Target Users / ICP Roles

- **ADMINS**: System administrators who monitor system performance and resource utilization.
- **HR MANAGERS**: Human resource managers responsible for maintaining optimal staffing levels.

## Scope

This requirement includes all necessary features to calculate agent utilization across multiple workstreams within a messaging platform. It does not cover features related to agent management, such as hiring, firing, or assigning agents to new workstreams.

## Functional Requirements

### Agent Util

- **Agent Roster**: Display a list of all available agents along with their details (name, skill set, availability, etc.).
- **Workstream Filter**: Allow users to filter workstreams based on specific criteria (e.g., department, time range).
- **Agent Assignment**: Display a detailed overview of all agents assigned to a specific workstream. Information should include:
  - Agent ID
  - Agent Name
  - Agent Availability
  - Current Workstream
  - Start and End Times of the Assignment

### Utilization Calculation

- **Total Assigned Agents**: Calculate the total number of agents assigned to all workstreams within a specific time range.
- **Agent Throughput**: Calculate the average throughput of assigned agents across all workstreams.

### Reporting

- **Real-time Agent Utilization**: Display agent utilization data in real-time throughout the day.
- **Historical Utilization**: Provide a history of agent utilization over a specified time range.

## Acceptance Criteria

- **Agent Roster**: Users can view and filter agent rosters as described above.
- **Workstream Filter**: Users can filter workstreams based on department and Time Range as specified.
- **Agent Assignment**: The Agent Assignment Report displays all agents assigned to a specific workstream with the required information.
- **Utilization Calculation**: The system calculates the total assigned agents and agent throughput as described.
- **Reporting**: Users can view real-time and historical agent utilization in the specified format.

## Out of Scope

- **Agent Management Features** (e.g., hiring, firing, assigning agents to new workstreams)
- **Integration with Existing Agent Management Systems** (e.g., HRIS, CRM)

(This PRD is specific to the messaging platform, but the agent utilization requirement itself is widely applicable to any communication platform with assigned workgroups or message queues.)