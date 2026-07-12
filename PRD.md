> **PRD** — drafted by Ada (Sr. Product Mgr) · task #399
> _Each agent that updates this PRD signs its change below._

# builtin\_chats\_consolidate (Task PRD)

## Problem & Goal
*The chats consolidation feature allows team members to merge multiple chats into one for better organization and visibility, enhancing communication and coordination within the team.*

## Target Users / ICP Roles (If Relevant)
* Chater [ICP]: Chat organizer, who requires a tool to consolidate chats and manage their conversations effectively.
* Chated [ICP]: Team members participating in chat threads, who benefit from a single consolidated view for improved visibility and understanding of discussions.

## Scope
* The builtin\_chats\_consolidate feature should support the following:
	+ Merging multiple chats from the same source (e.g., multiple team members, or multiple instances of a group chat) into a single chat.
	+ Allowing the target chat to be the recipient of new messages from all source chats.
	+ Providing an option for the target chat owner to manage the source chats as sub-threads.

## Functional Requirements

### Target Chat Creation and Organization
1. [ ] Create a new target chat with a unique identifier.
2. [ ] Organize source chats into sub-threads based on the target chat owner's rules.
3. [ ] Allow target chat owner to add source chats or remove them from sub-threads.

### Message Consolidation
1. [ ] Consolidate messages from all source chats into the target chat.
2. [ ] Ensure that timestamps, usernames, and other metadata are preserved and correctly aligned.
3. [ ] Optimize message display by removing duplicates and preserving original order.

### Maintaining Sub-threads
1. [ ] Display source chats as sub-threads within the target chat.
2. [ ] Maintain separate timestamps, usernames, and other metadata for each sub-thread.

### Permissions and Permissions Management¶
1. [ ] Assign appropriate permissions for each role (users, administrators, owners) and ensure they are enforced correctly.
2. [ ] Allow role management by target chat owner and source chat managers.

## Acceptance Criteria

1. **Requires all necessary permissions**: The builtin\_chats\_consolidate feature should work correctly when provided with the correct set of permissions required for each role.
2. **Uses source IDs to consolidate messages**: The builtin\_chats\_consolidate feature should reference original source IDs when consolidating messages, preserving history and metadata.
3. **Consolidates messages without loss**: The consolidated messages should be identical to the original source messages with all details correctly preserved.

## Out of Scope

The following are out of scope for this task:

1. **Non-consolidation features**: Do not implement features that allow users to consolidate messages within a single source chat.
2. **Other chat management features**: Do not implement features that allow users to perform actions on source chats (e.g., delete, rename, move) other than consolidating them into the target chat.
3. **Consolidating private messages**: Do not consolidate private messages (e.g., messages with restricted access) within target chat threads.