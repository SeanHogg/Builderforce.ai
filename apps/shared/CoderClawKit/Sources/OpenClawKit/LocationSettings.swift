import Foundation

public enum CoderClawLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
