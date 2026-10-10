import Foundation

public enum CoderClawDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum CoderClawBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum CoderClawThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum CoderClawNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum CoderClawNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct CoderClawBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: CoderClawBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: CoderClawBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct CoderClawThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: CoderClawThermalState

    public init(state: CoderClawThermalState) {
        self.state = state
    }
}

public struct CoderClawStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct CoderClawNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: CoderClawNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [CoderClawNetworkInterfaceType]

    public init(
        status: CoderClawNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [CoderClawNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct CoderClawDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: CoderClawBatteryStatusPayload
    public var thermal: CoderClawThermalStatusPayload
    public var storage: CoderClawStorageStatusPayload
    public var network: CoderClawNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: CoderClawBatteryStatusPayload,
        thermal: CoderClawThermalStatusPayload,
        storage: CoderClawStorageStatusPayload,
        network: CoderClawNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct CoderClawDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
