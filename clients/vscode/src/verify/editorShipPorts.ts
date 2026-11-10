/**
 * The ONE editor binding of the ship-gate ports (`shipPorts.ts`) — the live `vscode` module and
 * the host's git. Module-level, so the panel's run host and the native participant share one
 * verifier (and its cache) per workspace root for the life of the extension host.
 */

import * as vscode from "vscode";
import { gitRunner } from "./execRunner";
import { createShipPorts } from "./shipPorts";

export const editorShipPorts = createShipPorts({ vscode, git: gitRunner });
