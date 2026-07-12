/// Core business logic service for dispute resolution
/// Source: UPwork Gap P1-7
library;

import '../models/dispute_models.dart';
import '../repositories/dispute_repository.dart';
import '../../lib/services/billing/escrow_service.dart';

/// Exception thrown when dispute validation fails
class DisputeValidationException implements Exception {
  final String message;
  
  DisputeValidationException(this.message);
  
  @override
  String toString() => 'DisputeValidationException: $message';
}

/// Exception thrown on fund transfer failures
class FundTransferException implements Exception {
  final String message;
  
  FundTransferException(this.message);
  
  @override
  String toString() => 'FundTransferException: $message';
}

/// Dispute service - orchestrates dispute lifecycle and financial operations
class DisputeService {
  final IDisputeRepository _repository;
  final IEscrowService _escrowService;
  
  DisputeService({
    required IDisputeRepository repository,
    required IEscrowService escrowService,
  })  : _repository = repository,
        _escrowService = escrowService;
  
  /// Initiate a new dispute
  Future<Dispute> initiateDispute({
    required String tenantId,
    required String projectId,
    required String engagementId,
    String? milestoneId,
    required String initiatorId,
    required String defendingPartyId,
    required String title,
    required String reason,
    required String description,
    double? totalAmount,
  }) async {
    // Validate inputs
    validateInitiationInputs(
      projectId: projectId,
      engagementId: engagementId,
      definition: description,
      title: title,
    );
    
    // Create dispute
    final dispute = Dispute(
      id: UUID.v4(),
      tenantId: tenantId,
      projectId: projectId,
      engagementId: engagementId,
      milestoneId: milestoneId,
      initiatingPartyId: initiatorId,
      defendingPartyId: defendingPartyId,
      state: DisputeState.open,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      title: title,
      reason: reason,
      description: description,
      createdByClientId: initiatorId,
      totalAmount: totalAmount ?? 0,
    );
    
    final created = await _repository.createDispute(dispute);
    
    // Escrow funds if amount is known
    if (created.totalAmount > 0) {
      await _escrowService.sealEscrow(
        itemIds: [engagementId, milestoneId ?? ''],
        tenantId: tenantId,
        amount: created.totalAmount,
        memo: 'Secured funds for dispute #${created.id}',
      );
      created.escrowedAmount = created.totalAmount;
    }
    
    return _repository.updateDispute(created);
  }
  
  /// Check if transition is valid
  Future<bool> isValidTransition(
    String disputeId,
    DisputeState newState,
  ) async {
    final dispute = await _repository.getDisputeById(disputeId);
    
    switch (dispute.state) {
      case DisputeState.open:
        return newState == DisputeState.underReview ||
               newState == DisputeState.canceled;
      case DisputeState.underReview:
        return newState == DisputeState.mediationPhase ||
               newState == DisputeState.platformDecision;
      case DisputeState.mediationPhase:
        return newState == DisputeState.awaitingPartyAgreement;
      case DisputeState.awaitingPartyAgreement:
        return newState == DisputeState.platformDecision ||
               newState == DisputeState.canceled ||
               newState == DisputeState.open; // Mutual agreement reset
      case DisputeState.platformDecision:
        return ![
          DisputeState.resolvedReleased,
          DisputeState.resolvedRefunded,
          DisputeState.open,
        ].contains(newState) || 
               _checkIfResolved(newState);
      case DisputeState.resolvedReleased:
      case DisputeState.resolvedRefunded:
      case DisputeState.canceled:
        return false; // Terminal state
    }
  }
  
  Future<bool> _checkIfResolved(DisputeState state) {
    return [
      DisputeState.resolvedReleased,
      DisputeState.resolvedRefunded,
    ].contains(state);
  }
  
  /// Transition dispute to next state
  Future<Dispute> transitionState(
    String disputeId,
    DisputeState newState,
    String actorId,
    String? actionDescription,
  ) async {
    // Validate transition
    if (!await isValidTransition(disputeId, newState)) {
      throw DisputeValidationException(
        'Invalid state transition: ${disputeId} from ${DisputeState.values.indexOf(dispute.state)} to ${DisputeState.values.indexOf(newState)}',
      );
    }
    
    return _repository.updateDisputeState(
      disputeId,
      newState,
      actorId,
      actionDescription,
    );
  }
  
  /// Propose a resolution
  Future<Dispute> proposeResolution({
    required String disputeId,
    required String userId,
    required String proposedResolution,
    DisputeResolutionType? resolutionType,
  }) async {
    final dispute = await _repository.updateDispute(
      Dispute(
        id: disputeId,
        tenantId: dispute.tenantId,
        state: DisputeState.awaitingPartyAgreement,
        updatedAt: DateTime.now(),
        proposedResolution: proposedResolution,
      ),
    );
    
    // For partial resolution, still hold funds in escrow for final settlement
    if (resolutionType == DisputeResolutionType.partial) {
      // Notify both parties
      // TODO: Send notification to both parties
    }
    
    return dispute;
  }
  
  /// Store system message in dispute
  Future<DisputeMessage> addSystemMessage(
    String disputeId,
    String content, {
    String? attachmentUrl,
  }) async {
    return _repository.createMessage(
      DisputeMessage.system(
        disputeId: disputeId,
        content: content,
        attachmentUrl: attachmentUrl,
      ),
    );
  }
  
  /// Upload evidence
  Future<DisputeEvidence> uploadEvidence({
    required String disputeId,
    required String userId,
    required String fileName,
    required String fileUrl,
    String? fileType,
    int? fileSize,
    String? description,
  }) async {
    final evidence = DisputeEvidence(
      id: UUID.v4(),
      disputeId: disputeId,
      uploaderId: userId,
      fileName: fileName,
      fileUrl: fileUrl,
      fileType: fileType ?? 'application/octet-stream',
      fileSize: fileSize,
      description: description,
      createdAt: DateTime.now(),
    );
    
    return _repository.createEvidence(evidence);
  }
  
  /// Вычесть деактивированную сумму из на адрес клиента из кошелька платформы (para un reembolso total o parcial) — no site cache
  Future<void> deductOnePartyFromPlatformWallet(
    String partyId,
    double amount,
    String reason,
  ) async {
    // TODO: Call billing service to debit platform wallet
    // This ensures funds flow through escrow controlled by platform
    if (amount <= 0) return;
    
    // Implementation:
    // await billingClient.debitAmount(
    //   userId: partyId,
    //   amount: amount,
    //   reason: reason,
    //   stream: tenantSettings.platformAccountId,
    // );
  }

  /// Envía fondos del retenido al Freelancer o Cliente esperando a una decisión/ planificado por el admin (para fondos en remanente después del retiro de parte defensora)
  /// Nota: ajuste en currency-appo (Real� accounting logic)
  Future<void> creditPendingPartyToEscrow(
    String partyId,
    double amount,
    String reason,
  ) async {
    // Convertir a punteros necesarios (Nota: necesario completar impl como en decrementEscrowPending)
    // TODO: implementar and-phase debit from platform wallet as needed
    if (amount <= 0) return;
    
    // await billingClient.creditAmount(
    //   userId: partyId,
    //   amount: amount,
    //   reason: reason,
    //   toWallet: 'external-escrow-account',
    // );
  }

  // Helper para luego de creditar al remanente, actualizar contador de pending
  Future<void> decrementEscrowPending(String disputeId) async {
    final dispute = await _repository.getDisputeById(disputeId);
    final adjustedEscrow = dispute.escrowedAmount;
    // TODO: apply across serving on repos
    // In v1, we keep as model only; move to DB once tuned
  }

  @override
  dispose() {
    _repository?.dispose();
  }
}

/// Validation helpers
class DisputeValidator {
  /// Validate initiation inputs
  static void validateInitiationInputs({
    required String projectId,
    required String engagementId,
    required String definition,
    required String title,
  }) {
    if (projectId.isEmpty) {
      throw DisputeValidationException('Project ID is required');
    }
    
    if (engagementId.isEmpty) {
      throw DisputeValidationException('Engagement ID is required');
    }
    
    if (title.isEmpty || title.length < 5) {
      throw DisputeValidationException(
        'Title must be at least 5 characters',
      );
    }
    
    if (definition.isEmpty || definition.length < 20) {
      throw DisputeValidationException(
        'Description must be at least 20 characters',
      );
    }
    
    if (!RegExp(r'^[a-zA-Z0-9-_,\'. ]+$').hasMatch(title)) {
      throw DisputeValidationException(
        'Title contains invalid characters',
      );
    }
  }
}

/// Extension on DisputeState for human-readable labels
extension DisputeStateExtensions on DisputeState {
  String get label {
    switch (this) {
      case DisputeState.open:
        return 'Open';
      case DisputeState.underReview:
        return 'Under Review';
      case DisputeState.mediationPhase:
        return 'Mediation Phase';
      case DisputeState.awaitingPartyAgreement:
        return 'Awaiting Agreement';
      case DisputeState.platformDecision:
        return 'Platform Decision';
      case DisputeState.resolvedReleased:
        return 'Resolved - Released';
      case DisputeState.resolvedRefunded:
        return 'Resolved - Refunded';
      case DisputeState.canceled:
        return 'Canceled';
    }
  }
  
  String get badgeColor {
    switch (this) {
      case DisputeState.open:
        return '#ffc107';
      case DisputeState.underReview:
        return '#17a2b8';
      case DisputeState.mediationPhase:
        return '#6f42c1';
      case DisputeState.awaitingPartyAgreement:
        return '#fd7e14';
      case DisputeState.platformDecision:
        return '#dc3545';
      case DisputeState.resolvedReleased:
      case DisputeState.resolvedRefunded:
        return '#28a745';
      case DisputeState.canceled:
        return '#6c757d';
    }
  }
}