import CoreLocation
import Foundation
import CoderClawKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: CoderClawCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: CoderClawCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: CoderClawLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: CoderClawLocationGetParams,
        desiredAccuracy: CoderClawLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: CoderClawLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> CoderClawDeviceStatusPayload
    func info() -> CoderClawDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: CoderClawPhotosLatestParams) async throws -> CoderClawPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: CoderClawContactsSearchParams) async throws -> CoderClawContactsSearchPayload
    func add(params: CoderClawContactsAddParams) async throws -> CoderClawContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: CoderClawCalendarEventsParams) async throws -> CoderClawCalendarEventsPayload
    func add(params: CoderClawCalendarAddParams) async throws -> CoderClawCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: CoderClawRemindersListParams) async throws -> CoderClawRemindersListPayload
    func add(params: CoderClawRemindersAddParams) async throws -> CoderClawRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: CoderClawMotionActivityParams) async throws -> CoderClawMotionActivityPayload
    func pedometer(params: CoderClawPedometerParams) async throws -> CoderClawPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func sendNotification(
        id: String,
        title: String,
        body: String,
        priority: CoderClawNotificationPriority?) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
