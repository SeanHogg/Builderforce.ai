/// Enums for dispute resolution system
enum DisputeState {
  /// Initial state when dispute is created
  open,
  
  /// Platform administrator is reviewing the dispute
  underReview,
  
  /// Dispute has moved to active mediation phase
  mediationPhase,
  
  /// Awaiting agreement from one or both parties
  awaitingPartyAgreement,
  
  /// Platform administrator has made a decision
  platformDecision,
  
  /// Dispute resolved with funds released to freelancer
  resolvedReleased,
  
  /// Dispute resolved with full refund to client
  resolvedRefunded,
  
  /// Dispute was canceled (no resolution needed)
  canceled;
}

enum DisputeSeverity {
  critical,
  high,
  medium,
  low;
}

enum DisputeResolutionType {
  fullPayment,      // All funds to freelancer
  fullRefund,        // All funds returned to client
  partial,           // Partial distribution
  noAction,          // No financial action
}

enum DisputeMessageSender {
  client,
  freelancer,
  platformAdmin;
}

class DisputeTransition {
  final DisputeState from;
  final DisputeState to;
  final String actionDescription;
  final String? requires;
  
  const DisputeTransition({
    required this.from,
    required this.to,
    required this.actionDescription,
    this.requires,
  });
}

/// Valid state transitions for dispute lifecycle
const disputeTransitions = {
  DisputeState.open: {
    DisputeState.underReview: DisputeTransition(
      from: DisputeState.open,
      to: DisputeState.underReview,
      actionDescription: 'Platform admin starts review',
      requires: 'Platform administrator access',
    ),
    DisputeState.mediationPhase: DisputeTransition(
      from: DisputeState.open,
      to: DisputeState.mediationPhase,
      actionDescription: 'Platform admin initiates mediation',
      requires: 'Platform administrator access',
    ),
    DisputeState.canceled: DisputeTransition(
      from: DisputeState.open,
      to: DisputeState.canceled,
      actionDescription: 'Dispute canceled',
      requires: null,
    ),
  },
  
  DisputeState.underReview: {
    DisputeState.mediationPhase: DisputeTransition(
      from: DisputeState.underReview,
      to: DisputeState.mediationPhase,
      actionDescription: 'Platform admin moves to mediation',
      requires: 'Platform administrator access',
    ),
    DisputeState.platformDecision: DisputeTransition(
      from: DisputeState.underReview,
      to: DisputeState.platformDecision,
      actionDescription: 'Platform admin makes decision',
      requires: 'Platform administrator access',
    ),
    DisputeState.open: DisputeTransition(
      from: DisputeState.underReview,
      to: DisputeState.open,
      actionDescription: 'Dispute returned for revision',
      requires: null,
    ),
  },
  
  DisputeState.mediationPhase: {
    DisputeState.awaitingPartyAgreement: DisputeTransition(
      from: DisputeState.mediationPhase,
      to: DisputeState.awaitingPartyAgreement,
      actionDescription: 'Mediation complete, awaiting agreement',
      requires: null,
    ),
    DisputeState.platformDecision: DisputeTransition(
      from: DisputeState.mediationPhase,
      to: DisputeState.platformDecision,
      actionDescription: 'Platform admin overrides mediation',
      requires: 'Platform administrator access',
    ),
    DisputeState.open: DisputeTransition(
      from: DisputeState.mediationPhase,
      to: DisputeState.open,
      actionDescription: 'Mediation failed, reopen dispute',
      requires: null,
    ),
  },
  
  DisputeState.awaitingPartyAgreement: {
    DisputeState.resolvedReleased: DisputeTransition(
      from: DisputeState.awaitingPartyAgreement,
      to: DisputeState.resolvedReleased,
      actionDescription: 'Both parties agreed - funds released',
      requires: null,
    ),
    DisputeState.resolvedRefunded: DisputeTransition(
      from: DisputeState.awaitingPartyAgreement,
      to: DisputeState.resolvedRefunded,
      actionDescription: 'Both parties agreed - full refund',
      requires: null,
    ),
    DisputeState.platformDecision: DisputeTransition(
      from: DisputeState.awaitingPartyAgreement,
      to: DisputeState.platformDecision,
      actionDescription: 'Platform admin overrides to decision',
      requires: 'Platform administrator access',
    ),
  },
  
  DisputeState.platformDecision: {
    DisputeState.resolvedReleased: DisputeTransition(
      from: DisputeState.platformDecision,
      to: DisputeState.resolvedReleased,
      actionDescription: 'Platform admin decided - funds released',
      requires: 'Platform administrator access',
    ),
    DisputeState.resolvedRefunded: DisputeTransition(
      from: DisputeState.platformDecision,
      to: DisputeState.resolvedRefunded,
      actionDescription: 'Platform admin decided - full refund',
      requires: 'Platform administrator access',
    ),
    DisputeState.awaitingPartyAgreement: DisputeTransition(
      from: DisputeState.platformDecision,
      to: DisputeState.awaitingPartyAgreement,
      actionDescription: 'Platform decision rejects, send back to mediation',
      requires: 'Platform administrator access',
    ),
  },
  
  // Cannot transition from resolved or canceled states
};

/// Helper to check if a state transition is valid
bool isValidTransition(DisputeState currentState, DisputeState nextState) {
  final transitions = disputeTransitions[currentState];
  if (transitions == null) return false;
  return transitions.containsKey(nextState);
}