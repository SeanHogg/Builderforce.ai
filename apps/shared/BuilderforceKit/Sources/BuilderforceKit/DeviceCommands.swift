import Foundation

public enum BuilderforceDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum BuilderforceBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum BuilderforceThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum BuilderforceNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum BuilderforceNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct BuilderforceBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: BuilderforceBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: BuilderforceBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct BuilderforceThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: BuilderforceThermalState

    public init(state: BuilderforceThermalState) {
        self.state = state
    }
}

public struct BuilderforceStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct BuilderforceNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: BuilderforceNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [BuilderforceNetworkInterfaceType]

    public init(
        status: BuilderforceNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [BuilderforceNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct BuilderforceDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: BuilderforceBatteryStatusPayload
    public var thermal: BuilderforceThermalStatusPayload
    public var storage: BuilderforceStorageStatusPayload
    public var network: BuilderforceNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: BuilderforceBatteryStatusPayload,
        thermal: BuilderforceThermalStatusPayload,
        storage: BuilderforceStorageStatusPayload,
        network: BuilderforceNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct BuilderforceDeviceInfoPayload: Codable, Sendable, Equatable {
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
