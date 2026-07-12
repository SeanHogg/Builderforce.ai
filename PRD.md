> **PRD** — drafted by Ada (Sr. Product Mgr) · task #395
> _Each agent that updates this PRD signs its change below._

# Consolidate

## Problem & Goal
The goal is to provide a feature to consolidate individual chats and merge their contents into a specific chat (target chat). This helps to keep all relevant communications in one place, simplifying navigation and reducing clutter.

## Target Users / ICP Roles
This feature is intended for Product Owners, Scrum Masters, and Development Team leads who need to manage and track discussions related to their product. They should be able to identify the most relevant discussions to be merged and ensure that the target chat is the appropriate and accessible one.

## Scope
This feature allows for the consolidation of the following types of chats:

- **User chats**
- **Feature requests chats**
- **Epic chats**

All chats will be considered for consolidation, based on their relevance to the product. The target chat should be a 'product chat' (chat with a title that directly relates to the product's topic) to ensure structured and organized discussions.

## Functional Requirements

1. **Request access to consolidate chats:** A user can request access to the consolidate chats feature by providing a target chat ID and a list of source chat IDs.
2. **Implement consolidated chats:** The system should merge the contents of the source chat into the target chat. The merge process should preserve the original structure of each source chat, such as the order of messages, users, and pinned messages.
3. **Verify the merge results:** A review workflow should be implemented to verify the accuracy of the merge results. Users should be able to reopen any original messages or chats if necessary. The system should notify the user of any successful merges.

## Acceptance Criteria

1. **User can request access to consolidate chats:** A user can request access to the consolidate chats feature by filling out a form, selecting the target chat and source chat IDs, and submitting the request.
2. **Implement consolidated chats:** The system should merge all source chats into a single target chat, preserving the original structure of each source chat.
3. **Verify the merge results:** A review workflow should be in place to verify the accuracy of the merge results. If the system cannot accurately merge two chats, it should confirm with the user that the merge is successful and reopen the chats for review.

## Out of Scope

1. **Content migration:** Consoliding chats involves merging the contents of separate chat discussions, not moving users or permanent traces of their discussions.
2. **Default chats:** The feature should be designed to automatically consolidate chats, not to overrule default chat settings or overrides.
3. **Endless chats:** The system should not attempt to consolidate endless (never ending) chats.