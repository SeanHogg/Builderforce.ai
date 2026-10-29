/**
 * The role a cloud run's turns ask for (PRD 35 WS3). Every other part of the model hand-off — the phase rule, the run-start
 * seed, the per-turn request, the route-around of a failed turn, the stall step, the timeline wording — is the one agent's
 * (`@builderforce/agent-run` `policy/model`); the hand-off's timeline rows are the cloud adapter's sink.
 */
import { turnRole } from '@builderforce/agent-run';
import type { TurnRequest } from '@builderforce/run-policy';

/** The role the run's turns ask for — what the usage row and the pick are stamped with. */
export const cloudRunRole: (delegatedRole: string | null | undefined) => TurnRequest['role'] = turnRole;
