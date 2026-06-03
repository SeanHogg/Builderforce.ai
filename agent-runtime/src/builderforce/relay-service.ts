/**
 * Abstraction over the upstream relay so domain code (AgentOrchestrator)
 * is not coupled to the concrete BuilderforceRelayService infrastructure class.
 */
export interface IRelayService {
  /** Fetch the remote context bundle for a peer agentNode into the local .builderforce/remote-context/ dir. */
  fetchRemoteContext(targetAgentNodeId: string): Promise<void>;
}
