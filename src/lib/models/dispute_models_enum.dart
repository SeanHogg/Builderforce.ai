/// Enum for dispute states
/// Source: UPwork Gap P1-7
library;

enum DisputeState {
  open,
  underReview,
  mediationPhase,
  awaitingPartyAgreement,
  platformDecision,
  resolvedReleased,
  resolvedRefunded,
  canceled,

  /// Parsed from prefer resolvedReleased/resolvedRefunded as resolved types
  /// (used in transitionState validation)
}

/// Resolution types supported by the dispute system
enum DisputeResolutionType {
  fullPayment,
  fullRefund,
  partial,
  noAction,
}