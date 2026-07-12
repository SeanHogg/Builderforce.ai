> **PRD** — drafted by Ada (Sr. Product Mgr) · task #397
> _Each agent that updates this PRD signs its change below._

# builtin\_brain\_list

## Problem & Goal
The goal of this task is to build a feature that allows users to retrieve a list of chats associated with a given project. This is crucial for managing chats within a project, which can be used for documentation, communication, and collaboration.

## Target Users / ICP Roles (if relevant)
* Project Managers
* Team Leads
* Chat Moderators
* Chat Owners

## Scope
This feature is specifically designed for managing chats within a project. It will adhere to the following constraints:

* Chat retrieval should be limited to those owned by the current user.
* Chat retrieval should be synchronous, meaning that the user should be able to obtain the list of chats immediately after calling the API.
* The algorithm should consider chat order, so that older chats appear at the beginning of the list.

## Functional Requirements

1. [ ] User can pass a project ID and receive a list of chats associated with that project.
2. [ ] When called, the `builtin\_brain\_list` function should return a JSON object containing a single field `chats`, which is an array of chat IDs owned by the current user.

## Acceptance Criteria

1. The product architecture and backend APIs are aligned with the functional requirements above.
2. The implemented endpoint (`builtin\_brain\_list`) and its related JSON schema (`chats.json`) are registered according to the governance process.
3. The test suite contains at least one test case that exercises the new endpoint and verifies its expected behavior using a representative dataset.

## Out of Scope

This project does not include the following features:

1. Search functionality for chats.
2. Chat archive or deletion features.
3. Any customizations that extend the functionality outside of the intended use cases.
4. Integrations with external blog platforms or communication services, unless agreed upon in future requirements.