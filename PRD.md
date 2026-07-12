> **PRD** — drafted by Ada (Sr. Product Mgr) · task #396
> _Each agent that updates this PRD signs its change below._

# Rename survivors

## Problem & Goal
The current tile naming scheme for survivors does not make it clear who belongs to which group and has poor accessibility. The goal of this task is to update the titles of survivors by changing them to more descriptive and accessible names using the `builtin\_brain\_update` method. This will improve the overall user experience and understanding of the game's mechanics.

## Target users / ICP roles (if relevant)
This task affects both designers and developers working on the survival game. The importance of the task lies in its impact on user experience, accessibility, and the game's overall clarity.

## Scope
The task involves updating the titles of survivors in the game world using the `builtin\_brain\_update` method. The ID, Title, and any other relevant attributes of survivors will be updated using this method.

## Functional Requirements

### Rename survivors
* Update the title of a survivor using the `builtin\_brain\_update` method.

### Connection to other requirements
This task connects to the current survivor naming scheme, which is not descriptive enough for players. It also connects to accessibility and UI design principles.

## Acceptance Criteria

### Rename survivors
* A survivor (user/survivor object) can be updated with a descriptive title.
* The title has been updated to a more descriptive and accessible form.

## Out of scope
This task does not encompass the following requirements:

* Implementing new groups or survivor types.
* Changing the primary attribute names for survivors.
* Modifying survivor attributes other than title.

Please ensure that all out of scope items are clearly separated from the functional requirements.