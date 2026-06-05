import Foundation

public enum CoderClawCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum CoderClawCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum CoderClawCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum CoderClawCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct CoderClawCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: CoderClawCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: CoderClawCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: CoderClawCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: CoderClawCameraImageFormat? = nil,
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

public struct CoderClawCameraClipParams: Codable, Sendable, Equatable {
    public var facing: CoderClawCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: CoderClawCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: CoderClawCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: CoderClawCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
