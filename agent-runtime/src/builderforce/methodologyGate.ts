/**
 * PRD 49 gate. The one copy lives in `@builderforce/agent-tools` (`methodology.ts`) so the
 * editor's run host calls the SAME check; this module keeps the runtime's import path.
 */
export {
  checkGate,
  chatPersonaOf as loadChatPersona,
  PERSONA_OFF,
  producerOf,
  successorProducer,
  type ChatPersonaState,
  type GateResult,
} from "@builderforce/agent-tools";
