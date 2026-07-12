/// Data models for dispute resolution system
/// Source: UPwork Gap P1-7
library;

import 'uuid_exporter.dart';

/// Main dispute entity
class Dispute {
  final String id;
  final String tenantId;
  final String? projectId;
  final String? engagementId;
  final String? milestoneId;
  
  final String initiatingPartyId;
  final String defendingPartyId;
  
  final DisputeState state;
  final DateTime createdAt;
  final DateTime updatedAt;
  
  final String title;
  final String reason;
  final String description;
  final DisputeSeverity? severity;
  
  final int evidenceCount;
  
  final double totalAmount;
  final double escrowedAmount;
  
  final String? proposedResolution;
  final String? platformDecision;
  final String? resolutionNotes;
  final String? resolutionType;
  
  final String? resolvedBy;
  final DateTime? resolvedAt;
  
  final String createdByClientId;
  final String? lastModifiedById;

  Dispute({
    required this.id,
    required this.tenantId,
    this.projectId,
    this.engagementId,
    this.milestoneId,
    required this.initiatingPartyId,
    required this.defendingPartyId,
    required this.state,
    required this.createdAt,
    required this.updatedAt,
    required this.title,
    required this.reason,
    required this.description,
    this.severity,
    this.evidenceCount = 0,
    this.totalAmount = 0,
    this.escrowedAmount = 0,
    this.proposedResolution,
    this.platformDecision,
    this.resolutionNotes,
    this.resolutionType,
    this.resolvedBy,
    this.resolvedAt,
    required this.createdByClientId,
    this.lastModifiedById,
  });
  
  /// Check if dispute is in a resolvable state
  bool canBeResolved() {
    return state == DisputeState.awaitingPartyAgreement ||
           state == DisputeState.platformDecision;
  }

  /// Check if dispute is currently escrowed
  bool isEscrowed() {
    return escrowedAmount > 0;
  }
}

/// Dispute communication message
class DisputeMessage {
  final String id;
  final String disputeId;
  final String senderId;
  final String senderType;
  final String content;
  final bool isSystem;
  
  final String? attachmentUrl;
  final String? attachmentType;
  final DateTime createdAt;

  DisputeMessage({
    required this.id,
    required this.disputeId,
    required this.senderId,
    required this.senderType,
    required this.content,
    this.isSystem = false,
    this.attachmentUrl,
    this.attachmentType,
    required this.createdAt,
  });

  /// Create system message
  factory DisputeMessage.system({
    required String disputeId,
    required String content,
    String? attachmentUrl,
  }) {
    return DisputeMessage(
      id: UUID.v4(),
      disputeId: disputeId,
      senderId: '', // System messages have empty ID
      senderType: 'client', // Generic system type
      content: content,
      isSystem: true,
      attachmentUrl: attachmentUrl,
      attachmentType: null,
      createdAt: DateTime.now(),
    );
  }
}

/// Dispute evidence file
class DisputeEvidence {
  final String id;
  final String disputeId;
  final String uploaderId;
  final String fileName;
  final String fileUrl;
  final String fileType;
  final int? fileSize;
  final String? description;
  final DateTime createdAt;

  DisputeEvidence({
    required this.id,
    required this.disputeId,
    required this.uploaderId,
    required this.fileName,
    required this.fileUrl,
    required this.fileType,
    this.fileSize,
    this.description,
    required this.createdAt,
  });
}

/// Request to initiate a dispute
class InitiateDisputeRequest {
  final String projectId;
  final String engagementId;
  final String? milestoneId;
  final String title;
  final String reason;
  final String description;
  double? totalAmount;
  
  InitiateDisputeRequest({
    required this.projectId,
    required this.engagementId,
    this.milestoneId,
    required this.title,
    required this.reason,
    required this.description,
    this.totalAmount,
  });
}

/// Request to add a message to a dispute
class AddDisputeMessageRequest {
  final String senderType;
  final String content;
  String? attachmentUrl;
  String? attachmentType;
  bool isSystem = false;
  
  AddDisputeMessageRequest({
    required this.senderType,
    required this.content,
    this.attachmentUrl,
    this.attachmentType,
    this.isSystem = false,
  });
}

/// Request to upload evidence
class UploadEvidenceRequest {
  final String fileName;
  final String fileUrl;
  String? fileType;
  int? fileSize;
  String? description;
  
  UploadEvidenceRequest({
    required this.fileName,
    required this.fileUrl,
    this.fileType,
    this.fileSize,
    this.description,
  });
}

/// Request to update dispute resolution
class UpdateDisputeResolutionRequest {
  final String platformAdminId;
  final String resolutionType;
  final String platformDecision;
  final String resolutionNotes;
  List<String>? approvedEvidenceIds;
  
  UpdateDisputeResolutionRequest({
    required this.platformAdminId,
    required this.resolutionType,
    required this.platformDecision,
    required this.resolutionNotes,
    this.approvedEvidenceIds,
  });
}

/// DTO for listing disputes
class DisputeListItem {
  final String id;
  final String projectId;
  final String projectName;
  final String? engagementTitle;
  final String? milestoneTitle;
  final String title;
  final DisputeState state;
  final DisputeSeverity? severity;
  final DateTime createdAt;
  final DateTime? resolvedAt;
  final String initiatingPartyName;
  final String defendingPartyName;
  final double totalAmount;
  final double? escrowedAmount;
  
  DisputeListItem({
    required this.id,
    required this.projectId,
    required this.projectName,
    this.engagementTitle,
    this.milestoneTitle,
    required this.title,
    required this.state,
    this.severity,
    required this.createdAt,
    this.resolvedAt,
    required this.initiatingPartyName,
    required this.defendingPartyName,
    this.totalAmount = 0,
    this.escrowedAmount,
  });
}

/// Summary for dispute dashboard
class DisputeSummary {
  final int total;
  final int open;
  final int underReview;
  final int inMediation;
  final int awaitingAgreement;
  final int resolved;
  final int canceled;
  
  DisputeSummary({
    required this.total,
    required this.open,
    required this.underReview,
    required this.inMediation,
    required this.awaitingAgreement,
    required this.resolved,
    required this.canceled,
  });
}

/// Stats by severity
class DisputeSeverityStats {
  final int critical;
  final int high;
  final int medium;
  final int low;
  
  DisputeSeverityStats({
    this.critical = 0,
    this.high = 0,
    this.medium = 0,
    this.low = 0,
  });
}

/// Stats by time period
class DisputeTimelineStats {
  final DateTime periodStart;
  final DateTime periodEnd;
  final int totalInitiated;
  final int totalResolved;
  final double avgResolutionTimeInDays;
  
  DisputeTimelineStats({
    required this.periodStart,
    required this.periodEnd,
    this.totalInitiated = 0,
    this.totalResolved = 0,
    this.avgResolutionTimeInDays = 0,
  });
}