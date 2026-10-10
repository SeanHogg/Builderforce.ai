import Foundation

public enum BuilderforceCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum BuilderforceCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum BuilderforceCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum BuilderforceCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct BuilderforceCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: BuilderforceCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: BuilderforceCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: BuilderforceCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: BuilderforceCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct BuilderforceCameraClipParams: Codable, Sendable, Equatable {
    public var facing: BuilderforceCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: BuilderforceCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: BuilderforceCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: BuilderforceCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
