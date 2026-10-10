import CoreLocation
import Foundation
import BuilderforceKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: BuilderforceCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: BuilderforceCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
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
    func ensureAuthorization(mode: BuilderforceLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: BuilderforceLocationGetParams,
        desiredAccuracy: BuilderforceLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: BuilderforceLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> BuilderforceDeviceStatusPayload
    func info() -> BuilderforceDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: BuilderforcePhotosLatestParams) async throws -> BuilderforcePhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: BuilderforceContactsSearchParams) async throws -> BuilderforceContactsSearchPayload
    func add(params: BuilderforceContactsAddParams) async throws -> BuilderforceContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: BuilderforceCalendarEventsParams) async throws -> BuilderforceCalendarEventsPayload
    func add(params: BuilderforceCalendarAddParams) async throws -> BuilderforceCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: BuilderforceRemindersListParams) async throws -> BuilderforceRemindersListPayload
    func add(params: BuilderforceRemindersAddParams) async throws -> BuilderforceRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: BuilderforceMotionActivityParams) async throws -> BuilderforceMotionActivityPayload
    func pedometer(params: BuilderforcePedometerParams) async throws -> BuilderforcePedometerPayload
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
        priority: BuilderforceNotificationPriority?) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
