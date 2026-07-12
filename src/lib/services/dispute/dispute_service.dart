/// Implementation of Dispute Resolution business logic
/// Source: UPwork Gap P1-7
library;

import 'dart:uuid';
import '../../models/dispute_models.dart';
import '../../repositories/dispute_repository.dart';
import '../../repositories/engagement_repository.dart';
import '../../repositories/payment_repository.dart';
import '../../repositories/user_repository.dart';
import '../../exceptions/not_found_exception.dart';
import '../../exceptions/unauthorized_exception.dart';
import '../../exceptions/invalidStateException.dart';

/// Interface for dispute resolution service
abstract class IDisputeService {
  /// Create a new dispute
  Future<Dispute> initiateDispute({
    required String tenantId,
    required String projectId,
    required String engagementId,
    required String milestoneId,
    required String initiatingPartyId,
    required String defendingPartyId,
    required String title,
    required String reason,
    required String description,
    double? totalAmount,
  });

  /// Add a message to the dispute
  Future<DisputeMessage> addMessage({
    required String disputeId,
    required String userId,
    required String senderType,
    required String content,
    String? attachmentUrl,
    String? attachmentType,
    bool isSystem = false,
  });

  /// Upload evidence to the dispute
  Future<DisputeEvidence> uploadEvidence({
    required String disputeId,
    required String userId,
    required String fileName,
    required String fileUrl,
    String? fileType,
    int? fileSize,
    String? description,
  });

  /// Move dispute to next state
  Future<Dispute> transitionState({
    required String disputeId,
    required DisputeState nextState,
    required String actorId,
    String? actionDescription,
    String? requires,
  });

  /// Get dispute by ID
  Future<Dispute> getDispute(String disputeId);

  /// List disputes for a tenant/project
  Future<List<Dispute>> listDisputes({
    required String tenantId,
    String? projectId,
    String? engagementId,
    String? milestoneId,
    DisputeState? state,
    int limit = 50,
    String? sortBy,
  });

  /// Get dispute communications
  Future<List<DisputeMessage>> getDisputeMessages(String disputeId, {int limit = 100});

  /// Update dispute resolution
  Future<Dispute> updateResolution({
    required String disputeId,
    required String platformAdminId,
    required String resolutionType,
    required String platformDecision,
    required String resolutionNotes,
    List<String>? approvedEvidenceIds,
  });

  /// Cancel a dispute
  Future<Dispute> cancelDispute({
    required String disputeId,
    required String actorId,
    String reason = 'Dispute canceled by user',
  });

  /// Notify all parties about dispute creation
  Future<void> notifyDisputeCreated(Dispute dispute);
}

/// Main implementation of dispute resolution service
class DisputeService implements IDisputeService {
  final IDisputeRepository _disputeRepository;
  final IEngagementRepository _engagementRepository;
  final IPaymentRepository _paymentRepository;
  final IUserRepository _userRepository;
  
  DisputeService({
    required IDisputeRepository disputeRepository,
    required IEngagementRepository engagementRepository,
    required IPaymentRepository paymentRepository,
    required IUserRepository userRepository,
  })  : _disputeRepository = disputeRepository,
        _engagementRepository = engagementRepository,
        _paymentRepository = paymentRepository,
        _userRepository = userRepository;

  @override
  Future<Dispute> initiateDispute({
    required String tenantId,
    required String projectId,
    required String engagementId,
    required String milestoneId,
    required String initiatingPartyId,
    required String defendingPartyId,
    required String title,
    required String reason,
    required String description,
    double? totalAmount,
  }) async {
    // Validate engagement exists and is active
    final engagement = await _engagementRepository.getEngagement(engagementId);
    if (engagement.tenantId != tenantId) {
      throw UnauthorizedException('Tenant mismatch');
    }
    
    if (engagement.status != 'active') {
      throw UnauthorizedException('Engagement must be active to dispute');
    }

    // Validate both parties are engaged
    final client = await _userRepository.getUser(engagement.clientId);
    final freelancer = await _userRepository.getUser(engagement.freelancerId);
    
    final isClientInitiator = client.id == initiatingPartyId;
    final isFreelancerInitiator = freelancer.id == initiatingPartyId;
    
    if (!isClientInitiator && !isFreelancerInitiator) {
      throw UnauthorizedException('Only party to the engagement can initiate a dispute');
    }
    
    if (!isClientInitiator && defendingPartyId != freelancer.id) {
      throw UnauthorizedException('Defending party must be the other engagement member');
    }
    
    if (isFreelancerInitiator && defendingPartyId != client.id) {
      throw UnauthorizedException('Defending party must be the other engagement member');
    }

    // For milestones, validate funds are available (would escrow them)
    if (milestoneId != null) {
      final payment = await _paymentRepository.getMilestonePayment(milestoneId);
      if (payment == null) {
        throw NotFoundException('Milestone payment not found');
      }
      if (payment.status == 'disputed') {
        throw UnauthorizedException('This milestone is already in dispute');
      }
      if (payment.status == 'disbursed' && payment.amount > 0) {
        // Funds already disbursed - still allow dispute but funds may be unavailable
      }
      if (totalAmount == null || totalAmount == 0) {
        totalAmount = payment.amount;
      }
    }

    // Check if engagement has active disputes that block new ones
    final existingDisputes = await _disputeRepository.listDisputes(
      tenantId: tenantId,
      engagementId: engagementId,
      state: anyOf: [
        DisputeState.open,
        DisputeState.underReview,
        DisputeState.mediationPhase,
        DisputeState.awaitingPartyAgreement,
        DisputeState.platformDecision,
      ],
      limit: 1,
    );

    if (existingDisputes.isNotEmpty && existingDisputes.first.state != DisputeState.canceled) {
      throw UnauthorizedException('Cannot initiate new dispute while another dispute is active');
    }

    // Calculate escrowed amount (same as total for milestone disputes)
    final escrowedAmount = milestoneId != null ? totalAmount : 0;

    // Create the dispute
    final dispute = Dispute(
      id: UUID.v4(),
      tenantId: tenantId,
      projectId: projectId,
      engagementId: engagementId,
      milestoneId: milestoneId,
      initiatingPartyId: initiatingPartyId,
      defendingPartyId: defendingPartyId,
      state: DisputeState.open,
      title: title,
      reason: reason,
      description: description,
      totalAmount: totalAmount,
      escrowedAmount: escrowedAmount,
      proposedResolution: null,
      platformDecision: null,
      resolutionNotes: null,
      resolutionType: null,
    );

    final createdDispute = await _disputeRepository.createDispute(dispute);
    
    // TODO: Handle escrow flagging (moved funds to escrow state)
    // This would interact with payment repository to mark funds as disputed
    // if (milestoneId != null) {
    //   await _paymentRepository.markAsDisputed(milestoneId);
    // }

    // Send notifications
    await notifyDisputeCreated(createdDispute);

    return createdDispute;
  }

  @override
  Future<DisputeMessage> addMessage({
    required String disputeId,
    required String userId,
    required String senderType,
    required String content,
    String? attachmentUrl,
    String? attachmentType,
    bool isSystem = false,
  }) async {
    // Verify user has access to the dispute
    final dispute = await getDispute(disputeId);
    final user = await _userRepository.getUser(userId);
    
    if (user.tenantId != dispute.tenantId) {
      throw UnauthorizedException('Tenant mismatch');
    }

    final isPartyInvolved = userId == dispute.initiatingPartyId || 
                           userId == dispute.defendingPartyId ||
                           senderType == 'platform_admin';
    
    if (!isPartyInvolved && user.role != 'admin') {
      throw UnauthorizedException('User not involved in this dispute');
    }

    final isSenderParticipant = (senderType == 'client' && userId == dispute.initiatingPartyId) ||
                                (senderType == 'freelancer' && userId == dispute.defendingPartyId) ||
                                (senderType == 'platform_admin' && user.id == userId && user.role == 'admin');

    if (!isSenderParticipant && !isSystem) {
      throw UnauthorizedException('Sender must be a party to this dispute or system');
    }

    final message = DisputeMessage(
      id: UUID.v4(),
      disputeId: disputeId,
      senderId: userId,
      senderType: senderType,
      content: content,
      isSystem: isSystem,
      attachmentUrl: attachmentUrl,
      attachmentType: attachmentType,
    );

    return await _disputeRepository.createMessage(message);
  }

  @override
  Future<DisputeEvidence> uploadEvidence({
    required String disputeId,
    required String userId,
    required String fileName,
    required String fileUrl,
    String? fileType,
    int? fileSize,
    String? description,
  }) async {
    final dispute = await getDispute(disputeId);
    final user = await _userRepository.getUser(userId);
    
    if (user.tenantId != dispute.tenantId) {
      throw UnauthorizedException('Tenant mismatch');
    }

    // Only parties involved can upload evidence
    if (userId != dispute.initiatingPartyId && userId != dispute.defendingPartyId) {
      throw UnauthorizedException('Only involved parties can upload evidence');
    }

    final evidence = DisputeEvidence(
      id: UUID.v4(),
      disputeId: disputeId,
      uploaderId: userId,
      fileName: fileName,
      fileUrl: fileUrl,
      fileType: fileType ?? 'application/octet-stream',
      fileSize: fileSize,
      description: description,
    );

    return await _disputeRepository.createEvidence(evidence);
  }

  @override
  Future<Dispute> transitionState({
    required String disputeId,
    required DisputeState nextState,
    required String actorId,
    String? actionDescription = '',
    String? requires = null,
  }) async {
    final dispute = await getDispute(disputeId);
    final user = await _userRepository.getUser(actorId);

    // Validate state transition
    if (!isValidTransition(dispute.state, nextState)) {
      throw InvalidStateException(
        'Invalid state transition: ${dispute.state.name} -> ${nextState.name}',
      );
    }

    // Verify actor is authorized to make this transition
    final isAdmin = user.role == 'admin';
    final isPlatformAdminAction = (
      (nextState == DisputeState.underReview || 
       nextState == DisputeState.platformDecision) && isAdmin
    );
    final isMediationAction = (
      (nextState == DisputeState.mediationPhase) && isAdmin
    );
    final isPartyAction = (
      (dispute.state == DisputeState.open && 
       ((user.id == dispute.initiatingPartyId && nextState == DisputeState.canceled)))
    );
    final isAgreementAction = (
      (dispute.state == DisputeState.awaitingPartyAgreement && 
       (nextState == DisputeState.resolvedReleased || 
        nextState == DisputeState.resolvedRefunded) &&
       actorId == dispute.initiatingPartyId &&
       actorId == dispute.defendingPartyId)
    );

    if (!isAdmin && !isPlatformAdminAction && !isMediationAction && !isPartyAction && !isAgreementAction) {
      throw UnauthorizedException('Actor not authorized to transition this dispute');
    }

    // Execute the transition
    final updatedDispute = await _disputeRepository.updateDisputeState(
      disputeId,
      nextState,
      user.id,
      actionDescription,
    );

    // Handle post-transition logic
    if (nextState == DisputeState.platformDecision || 
        nextState == DisputeState.resolvedReleased ||
        nextState == DisputeState.resolvedRefunded) {
      
      // TODO: Execute financial resolution (release funds)
      // This would call payment service to reflect the decision
    }

    return updatedDispute;
  }

  @override
  Future<Dispute> getDispute(String disputeId) {
    return _disputeRepository.getDisputeById(disputeId);
  }

  @override
  Future<List<Dispute>> listDisputes({
    required String tenantId,
    String? projectId,
    String? engagementId,
    String? milestoneId,
    DisputeState? state,
    int limit = 50,
    String? sortBy,
  }) async {
    return _disputeRepository.listDisputes(
      tenantId: tenantId,
      projectId: projectId,
      engagementId: engagementId,
      milestoneId: milestoneId,
      state: state,
      limit: limit,
      sortBy: sortBy,
    );
  }

  @override
  Future<List<DisputeMessage>> getDisputeMessages(String disputeId, {int limit = 100}) {
    return _disputeRepository.getDisputeMessages(disputeId, limit: limit);
  }

  @override
  Future<Dispute> updateResolution({
    required String disputeId,
    required String platformAdminId,
    required String resolutionType,
    required String platformDecision,
    required String resolutionNotes,
    List<String>? approvedEvidenceIds,
  }) async {
    final dispute = await getDispute(disputeId);
    final user = await _userRepository.getUser(platformAdminId);
    
    if (user.role != 'admin') {
      throw UnauthorizedException('Only platform administrators can update resolution');
    }

    // Validate resolution type
    const validTypes = [
      'full_payment',
      'full_refund',
      'partial',
      'no_action'
    ];
    
    if (!validTypes.contains(resolutionType)) {
      throw InvalidStateException('Invalid resolution type: $resolutionType');
    }

    // Update the dispute with resolution details
    final updatedDispute = await _disputeRepository.updateDisputeResolution(
      disputeId,
      platformAdminId,
      resolutionType,
      platformDecision,
      resolutionNotes,
    );

    // TODO: Execute financial resolution based on type
    // full_payment: release to freelancer
    // full_refund: refund to client
    // partial: split according to details
    // no_action: no funds moved
    // await _paymentService.executeFinancialResolution(updatedDispute, resolutionType);

    return updatedDispute;
  }

  @override
  Future<Dispute> cancelDispute({
    required String disputeId,
    required String actorId,
    String reason = 'Dispute canceled by user',
  }) async {
    return transitionState(
      disputeId: disputeId,
      nextState: DisputeState.canceled,
      actorId: actorId,
      actionDescription: reason,
    );
  }

  @override
  Future<void> notifyDisputeCreated(Dispute dispute) async {
    // TODO: Implement notification logic
    // This should send emails to all parties and (for admins) to platform team
    
    // Notify initiating party
    // await _notificationService.send(
    //   to: dispute.initiatingPartyId,
    //   type: 'dispute_initiated',
    //   title: 'Dispute Created',
    //   message: 'Dispute ${dispute.id} has been created',
    // );
    
    // Notify defending party
    // await _notificationService.send(
    //   to: dispute.defendingPartyId,
    //   type: 'dispute_initiated',
    //   title: 'Dispute Created',
    //   message: 'Dispute ${dispute.id} has been created against you',
    // );
  }
}

/// Helper to check if a state transition is valid
bool isValidTransition(DisputeState currentState, DisputeState nextState) {
  if (currentState == nextState) return false;
  if (nextState == DisputeState.canceled) {
    // Only 'open' state can transition to 'canceled'
    return currentState == DisputeState.open;
  }
  
  final transitions = disputeTransitions[currentState];
  if (transitions == null) return false;
  return transitions.containsKey(nextState);
}