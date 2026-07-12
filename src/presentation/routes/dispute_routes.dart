/// REST API routes for dispute resolution
/// Source: UPwork Gap P1-7
library;

import 'package:dio/dio.dart';
import '../../lib/models/dispute_models.dart';
import '../../lib/services/dispute/dispute_service.dart';

/// API client for dispute resolution endpoints
class DisputeApiClient {
  final Dio _dio;
  final String _baseUrl;
  
  DisputeApiClient({
    required Dio dio,
    String baseUrl = '/api/disputes',
  })  : _dio = dio,
        _baseUrl = baseUrl;
  
  /// Initiate a new dispute
  Future<Dispute> initiateDispute({
    required String tenantId,
    String projectId,
    String engagementId,
    String milestoneId,
    required String initiatingPartyId,
    required String defendingPartyId,
    required String title,
    required String reason,
    required String description,
    double? totalAmount,
  }) async {
    final response = await _dio.post(
      '$_baseUrl/initiate',
      data: {
        'tenantId': tenantId,
        'projectId': projectId,
        'engagementId': engagementId,
        'milestoneId': milestoneId,
        'initiatingPartyId': initiatingPartyId,
        'defendingPartyId': defendingPartyId,
        'title': title,
        'reason': reason,
        'description': description,
        'totalAmount': totalAmount,
      },
      options: Options(
        headers: {'Content-Type': 'application/json'},
        validateStatus: (status) => status! < 500,
      ),
    );
    
    return Dispute.fromJson(response.data['dispute']);
  }
  
  /// Get a single dispute
  Future<Dispute> getDispute(String disputeId) async {
    final response = await _dio.get('$_baseUrl/$disputeId');
    return Dispute.fromJson(response.data['dispute']);
  }
  
  /// List disputes with filters
  Future<List<Dispute>> listDisputes({
    required String tenantId,
    String? projectId,
    String? engagementId,
    String? milestoneId,
    String? state,
    int limit = 50,
    String? sortBy,
  }) async {
    final response = await _dio.get(
      '$_baseUrl',
      queryParameters: {
        'tenantId': tenantId,
        if (projectId != null) 'projectId': projectId,
        if (engagementId != null) 'engagementId': engagementId,
        if (milestoneId != null) 'milestoneId': milestoneId,
        if (state != null) 'state': state,
        'limit': limit,
        if (sortBy != null) 'sortBy': sortBy,
      },
    );
    
    return List.generate(
      response.data['disputes'].length,
      (index) => Dispute.fromJson(response.data['disputes'][index]),
    );
  }
  
  /// Add a message to a dispute
  Future<DisputeMessage> addMessage({
    required String disputeId,
    required String userId,
    required String senderType,
    required String content,
    String? attachmentUrl,
    String? attachmentType,
    bool isSystem = false,
  }) async {
    final response = await _dio.post(
      '$_baseUrl/$disputeId/messages',
      data: {
        'senderId': userId,
        'senderType': senderType,
        'content': content,
        'attachmentUrl': attachmentUrl,
        'attachmentType': attachmentType,
        'isSystem': isSystem,
      },
    );
    
    return DisputeMessage.fromJson(response.data['message']);
  }
  
  /// Upload evidence file
  Future<DisputeEvidence> uploadEvidence({
    required String disputeId,
    required String userId,
    required String fileName,
    required String fileUrl,
    String? fileType,
    int? fileSize,
    String? description,
  }) async {
    final response = await _dio.post(
      '$_baseUrl/$disputeId/evidence',
      data: {
        'uploaderId': userId,
        'fileName': fileName,
        'fileUrl': fileUrl,
        'fileType': fileType,
        'fileSize': fileSize,
        'description': description,
      },
    );
    
    return DisputeEvidence.fromJson(response.data['evidence']);
  }
  
  /// Get dispute messages
  Future<List<DisputeMessage>> getDisputeMessages(
    String disputeId, {
    int limit = 100,
  }) async {
    final response = await _dio.get(
      '$_baseUrl/$disputeId/messages',
      queryParameters: {'limit': limit},
    );
    
    return List.generate(
      response.data['messages'].length,
      (index) => DisputeMessage.fromJson(response.data['messages'][index]),
    );
  }
  
  /// Get dispute evidence
  Future<List<DisputeEvidence>> getEvidence(String disputeId) async {
    final response = await _dio.get('$_baseUrl/$disputeId/evidence');
    
    return List.generate(
      response.data['evidence'].length,
      (index) => DisputeEvidence.fromJson(response.data['evidence'][index]),
    );
  }
  
  /// Transition dispute to next state
  Future<Dispute> transitionState({
    required String disputeId,
    required String state,
    required String actorId,
    String? actionDescription,
  }) async {
    final response = await _dio.patch(
      '$_baseUrl/$disputeId/transition',
      data: {
        'state': state,
        'actorId': actorId,
        'actionDescription': actionDescription,
      },
    );
    
    return Dispute.fromJson(response.data['dispute']);
  }
  
  /// Update dispute resolution
  Future<Dispute> updateResolution({
    required String disputeId,
    required String platformAdminId,
    required String resolutionType,
    required String platformDecision,
    required String resolutionNotes,
  }) async {
    final response = await _dio.patch(
      '$_baseUrl/$disputeId/resolution',
      data: {
        'platformAdminId': platformAdminId,
        'resolutionType': resolutionType,
        'platformDecision': platformDecision,
        'resolutionNotes': resolutionNotes,
      },
    );
    
    return Dispute.fromJson(response.data['dispute']);
  }
  
  /// Cancel a dispute
  Future<Dispute> cancelDispute({
    required String disputeId,
    required String actorId,
    String reason = 'Dispute canceled',
  }) async {
    final response = await _dio.post(
      '$_baseUrl/$disputeId/cancel',
      data: {
        'actorId': actorId,
        'reason': reason,
      },
    );
    
    return Dispute.fromJson(response.data['dispute']);
  }
}

/// Example server endpoint implementations (to be wired to backend)
/// These would be implemented in a Dart/Flutter backend or generic API layer

/// Endpoint: POST /api/disputes/initiate
/// Initiates a new dispute on an engagement or milestone
Future<Map<String, dynamic>> handleInitiateDispute(Request request) async {
  final data = await request.body;
  
  // Validation
  final requiredFields = [
    'tenantId',
    'projectId',
    'engagementId',
    'initiatingPartyId',
    'defendingPartyId',
    'title',
    'reason',
    'description',
  ];
  
  for (final field in requiredFields) {
    if (!data.containsKey(field)) {
      return {
        'success': false,
        'error': 'Missing required field: $field',
      };
    }
  }
  
  // TODO: Call DisputeService.initiateDispute()
  // This would be wired to the implementation in dispute_service.dart
  
  return {
    'success': true,
    'dispute': {
      'id': 'dispute_placeholder',
      'tenantId': data['tenantId'],
      'state': 'open',
      'createdAt': DateTime.now().toIso8601String(),
    },
  };
}

/// Endpoint: GET /api/disputes/:id
/// Retrieves a single dispute with all details
Future<Map<String, dynamic>> handleGetDispute(Request request) async {
  final disputeId = request.pathParameters['id'];
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  // TODO: Call DisputeService.getDispute()
  
  return {
    'success': true,
    'dispute': {
      // TODO: Populate with actual dispute data
      'id': disputeId,
      'title': 'Sample Dispute',
      'state': 'open',
      'createdAt': DateTime.now().toIso8601String(),
    },
  };
}

/// Endpoint: GET /api/disputes
/// Lists disputes with filtering
Future<Map<String, dynamic>> handleListDisputes(Request request) async {
  final queryParams = request.queryParameters;
  
  // TODO: Call DisputeService.listDisputes()
  
  return {
    'success': true,
    'disputes': [
      // TODO: Paginated list
    ],
    'total': 0,
    'limit': int.tryParse(queryParams['limit'] ?? '50') ?? 50,
  };
}

/// Endpoint: POST /api/disputes/:id/messages
/// Adds a message to the dispute communication thread
Future<Map<String, dynamic>> handleAddMessage(Request request) async {
  final disputeId = request.pathParameters['id'];
  final data = await request.body;
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  // TODO: Call DisputeService.addMessage()
  
  return {
    'success': true,
    'message': {
      // TODO: Populate message data
    },
  };
}

/// Endpoint: POST /api/disputes/:id/evidence
/// Uploads evidence file to the dispute
Future<Map<String, dynamic>> handleUploadEvidence(Request request) async {
  final disputeId = request.pathParameters['id'];
  final data = await request.body;
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  // TODO: Validate file size/type
  // TODO: Upload to storage service (R2, S3, etc.)
  
  // TODO: Call DisputeService.uploadEvidence()
  
  return {
    'success': true,
    'evidence': {
      'id': 'evidence_placeholder',
      'fileName': data['fileName'],
      'fileUrl': data['fileUrl'],
    },
  };
}

/// Endpoint: PATCH /api/disputes/:id/transition
/// Transitions dispute to next state
Future<Map<String, dynamic>> handleTransitionState(Request request) async {
  final disputeId = request.pathParameters['id'];
  final data = await request.body;
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  final validStates = [
    'open',
    'under_review',
    'mediation_phase',
    'awaiting_party_agreement',
    'platform_decision',
    'resolved_released',
    'resolved_refunded',
    'canceled',
  ];
  
  if (!validStates.contains(data['state'])) {
    return {
      'success': false,
      'error': 'Invalid state',
    };
  }
  
  // TODO: Call DisputeService.transitionState()
  // This would validate state transitions and update database
  
  return {
    'success': true,
    'dispute': {
      'id': disputeId,
      'state': data['state'],
    },
  };
}

/// Endpoint: PATCH /api/disputes/:id/resolution
/// Updates dispute resolution with platform decision
Future<Map<String, dynamic>> handleUpdateResolution(Request request) async {
  final disputeId = request.pathParameters['id'];
  final data = await request.body;
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  // Validate resolution type
  final validTypes = ['full_payment', 'full_refund', 'partial', 'no_action'];
  if (!validTypes.contains(data['resolutionType'])) {
    return {
      'success': false,
      'error': 'Invalid resolution type',
    };
  }
  
  // TODO: Validate platform admin authorization
  final platformAdminId = data['platformAdminId'];
  if (platformAdminId == null) {
    return {
      'success': false,
      'error': 'Platform admin ID required',
    };
  }
  
  // TODO: Call DisputeService.updateResolution()
  // This would apply the resolution and update financial state
  
  return {
    'success': true,
    'dispute': {
      'id': disputeId,
      'state': data['resolutionType'] == 'partial' 
          ? 'awaiting_party_agreement'
          : 'resolved_${data['resolutionType'].replaceAll('_', '-')}',
      'resolutionType': data['resolutionType'],
    },
  };
}

/// Endpoint: POST /api/disputes/:id/cancel
/// Cancels a dispute
Future<Map<String, dynamic>> handleCancelDispute(Request request) async {
  final disputeId = request.pathParameters['id'];
  final data = await request.body;
  
  if (disputeId == null) {
    return {
      'success': false,
      'error': 'Dispute ID required',
    };
  }
  
  // TODO: Call DisputeService.cancelDispute()
  
  return {
    'success': true,
    'dispute': {
      'id': disputeId,
      'state': 'canceled',
    },
  };
}

/// Routes setup for dispute endpoint
void setupDisputeRoutes(Router router) {
  // Dispute listing
  router.get('/api/disputes', handleListDisputes);
  
  // Single dispute
  router.get('/api/disputes/<id>', handleGetDispute);
  
  // Initiate dispute
  router.post('/api/disputes/initiate', handleInitiateDispute);
  
  // Messages
  router.get('/api/disputes/<id>/messages', handleGetMessages);
  router.post('/api/disputes/<id>/messages', handleAddMessage);
  
  // Evidence
  router.get('/api/disputes/<id>/evidence', handleGetEvidence);
  router.post('/api/disputes/<id>/evidence', handleUploadEvidence);
  
  // State transitions
  router.patch('/api/disputes/<id>/transition', handleTransitionState);
  
  // Resolution
  router.patch('/api/disputes/<id>/resolution', handleUpdateResolution);
  
  // Cancel
  router.post('/api/disputes/<id>/cancel', handleCancelDispute);
}