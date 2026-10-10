import Foundation

/// One tool of the platform's catalog (`GET /llm/v1/mcp/tools`) — the ONE server-side
/// catalog the web Brain, the VS Code extension and Synapse also drive. Nothing is
/// re-declared here; a tool added on the platform reaches the apps by itself.
public struct PlatformTool: Decodable, Sendable, Equatable {
    /// Which server owns it; sent back on the call.
    public let extensionId: String
    /// Its name on that server; sent back on the call.
    public let tool: String
    /// The flat name the model sees (`builtin_tasks_create`).
    public let name: String
    public let description: String
    public let parameters: AnyCodable?
    /// Whether it changes anything. Absent (a tenant's own MCP server) counts as yes.
    public let mutates: Bool?

    enum CodingKeys: String, CodingKey {
        case extensionId
        case tool
        case name
        case description
        case parameters
        case mutates
    }

    public init(
        extensionId: String,
        tool: String,
        name: String,
        description: String = "",
        parameters: AnyCodable? = nil,
        mutates: Bool? = nil)
    {
        self.extensionId = extensionId
        self.tool = tool
        self.name = name
        self.description = description
        self.parameters = parameters
        self.mutates = mutates
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.extensionId = try container.decode(String.self, forKey: .extensionId)
        self.tool = try container.decode(String.self, forKey: .tool)
        self.name = try container.decode(String.self, forKey: .name)
        self.description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        self.parameters = try container.decodeIfPresent(AnyCodable.self, forKey: .parameters)
        self.mutates = try container.decodeIfPresent(Bool.self, forKey: .mutates)
    }

    /// Whether running it needs the person's go-ahead.
    public var writes: Bool {
        self.mutates != false
    }

    /// A tool's name as a person reads it: `builtin_tasks_create` → `tasks create`.
    public var label: String {
        Self.label(for: self.name)
    }

    public static func label(for name: String) -> String {
        let bare = name.hasPrefix("builtin_") ? String(name.dropFirst("builtin_".count)) : name
        return bare.replacingOccurrences(of: "_", with: " ")
    }

    /// The tool as a completion request offers it to the model.
    var asFunction: CompletionTool {
        CompletionTool(function: CompletionTool.Function(
            name: self.name,
            description: self.description,
            parameters: self.parameters ?? AnyCodable(["type": "object", "properties": [String: Any]()])))
    }
}

/// The catalog and its calls, run on the platform as the signed-in person.
struct PlatformToolsClient: Sendable {
    /// A call can be a search or an import; give it the time it takes.
    static let callTimeout: TimeInterval = 120

    let session: CloudSession

    /// The tools of one catalog `surface` (`delivery`: projects, tickets, boards, specs,
    /// OKRs, the workspace's connectors — not the platform's own administration).
    func tools(surface: String) async throws -> [PlatformTool] {
        struct Listing: Decodable { let tools: [PlatformTool]? }
        let request = try self.session.gatewayRequest(
            method: "GET",
            path: "/mcp/tools?surface=\(surface)",
            body: nil,
            timeout: CloudSession.apiTimeout)
        let data = try await Self.body(self.session.http.send(request))
        return try CloudJSON.decode(Listing.self, from: data).tools ?? []
    }

    /// Run one tool; the result as the text the model reads back.
    func call(_ tool: PlatformTool, arguments: AnyCodable) async throws -> String {
        struct Call: Encodable {
            let extensionId: String
            let tool: String
            let arguments: AnyCodable
        }
        let body = try CloudJSON.encode(Call(extensionId: tool.extensionId, tool: tool.tool, arguments: arguments))
        let request = try self.session.gatewayRequest(
            method: "POST",
            path: "/mcp/call",
            body: body,
            timeout: Self.callTimeout)
        let data = try await Self.body(self.session.http.send(request))
        return Self.resultText(data)
    }

    /// `{"result": …}` as text: a string as is, anything else as JSON.
    static func resultText(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return String(decoding: data, as: UTF8.self)
        }
        let result = (object as? [String: Any])?["result"] ?? object
        if let text = result as? String { return text }
        guard JSONSerialization.isValidJSONObject(result),
              let encoded = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        else { return String(describing: result) }
        return String(decoding: encoded, as: UTF8.self)
    }

    /// The LLM gateway's answer body; a refused key is `keyRejected`.
    static func body(_ response: CloudHTTPResponse) throws -> Data {
        if response.status == 401 { throw CloudError.keyRejected }
        return try CloudSession.body(of: response)
    }
}
