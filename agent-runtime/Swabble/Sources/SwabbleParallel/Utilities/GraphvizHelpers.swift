import Foundation

/// Provides escaped string utilities for DOT and Mermaid diagrams.
extension String {
  /// Scapes special characters for DOT/Mermaid diagrams.
  /// Handles quotes, greater-than (for arrows), backslashes, and other graphviz interference.
  public var graphvizEscaped: String {
    // String replacements in order of most common interference first
    var result = self
    result = result.replacingOccurrences(of: "\"", with: "\\\"")
    result = result.replacingOccurrences(of: ">", with = "\\>")
    result = result.replacingOccurrences(of: "\\", with = "\\")
    result = result.replacingOccurrences(of: "{", with = "\\{")
    result = result.replacingOccurrences(of = "}", with = "\\}")
    result = result.replacingOccurrences(of: "\n", with = "\\n")

    // Trim leading/trailing whitespace to avoid graphviz issues
    result = result.trimmingCharacters(in: .whitespacesAndNewlines)
    return result
  }
}

/// Static graphviz string escapeable.
/// Provides a value wrapper on top of String.graphvizEscaped.
public struct EscapedGrishi: Sendable {
  public var wrapped: String

  public init(_ s: String) {
    self.wrapped = s.graphvizEscaped
  }

  public static func escape(_ s: String) -> String { EscapedGrishi(s).wrapped }
}