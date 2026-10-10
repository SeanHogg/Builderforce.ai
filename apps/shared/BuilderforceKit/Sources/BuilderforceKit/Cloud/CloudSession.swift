import Foundation

/// One platform API call, before it is authorised: method, path (`/api/…`, query
/// included) and JSON body. Built by the typed APIs, executed by [`CloudSession`].
public struct CloudAPIRequest: Sendable, Equatable {
    public let method: String
    public let path: String
    public let body: Data?

    public init(method: String, path: String, body: Data? = nil) {
        self.method = method
        self.path = path
        self.body = body
    }
}

/// A workspace the signed-in person belongs to.
public struct CloudWorkspace: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let role: String?
}

/// A signed-in session: the `bfk_` key, exchanged for a short-lived workspace token
/// (`POST /api/auth/tenant-api-key-token`) and re-scoped to a chosen workspace
/// (`POST /api/vscode/tenants/{id}/token`). The token is reused until a minute before it
/// expires; a 401 re-exchanges once; a refused key is `CloudError.keyRejected`.
public actor CloudSession {
    private struct Token {
        let value: String
        let tenantID: Int
        let expiresAt: Date
    }

    private struct Minted: Decodable {
        let token: String
        let expiresIn: Int?
        let tenantId: Int
    }

    private static let refreshMargin: TimeInterval = 60
    public static let apiTimeout: TimeInterval = 20

    public nonisolated let config: CloudConfig
    /// The key itself: the LLM gateway's credential, and what the token is minted from.
    nonisolated let apiKey: String
    nonisolated let http: any CloudHTTPClient
    private var workspaceID: Int?
    private var token: Token?

    public init(apiKey: String, config: CloudConfig, http: any CloudHTTPClient, workspaceID: Int? = nil) {
        self.apiKey = apiKey
        self.config = config
        self.http = http
        self.workspaceID = workspaceID
    }

    /// Work in `id` from now on (`nil` = the workspace the key was minted for).
    public func setWorkspace(_ id: Int?) {
        self.workspaceID = id
        self.token = nil
    }

    /// The workspace the session works in now.
    public func currentTenantID() async throws -> Int {
        _ = try await self.bearer()
        guard let token = self.token else { throw CloudError.signedOut }
        return token.tenantID
    }

    /// Call the platform API as the signed-in person; the answer's body. A 401 re-exchanges
    /// the token once.
    public func perform(_ request: CloudAPIRequest, timeout: TimeInterval = CloudSession.apiTimeout) async throws -> Data {
        let first = try await self.send(request, timeout: timeout)
        if first.status == 401 {
            self.token = nil
            return try await Self.body(of: self.send(request, timeout: timeout))
        }
        return try Self.body(of: first)
    }

    /// Upload one file to the chat uploads store (`POST /api/brain/upload`, multipart).
    public func upload(fileName: String, mimeType: String, data: Data) async throws -> Data {
        let boundary = "bf-\(UUID().uuidString)"
        let body = Self.multipartBody(fileName: fileName, mimeType: mimeType, data: data, boundary: boundary)
        let build: (String) throws -> URLRequest = { bearer in
            var request = try self.urlRequest(path: "/api/brain/upload", method: "POST", timeout: 120)
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
            return request
        }
        var response = try await self.http.send(build(self.bearer()))
        if response.status == 401 {
            self.token = nil
            response = try await self.http.send(build(self.bearer()))
        }
        return try Self.body(of: response)
    }

    public func workspaces() async throws -> [CloudWorkspace] {
        struct Listing: Decodable { let tenants: [CloudWorkspace]? }
        let data = try await self.perform(CloudAPIRequest(method: "GET", path: "/api/vscode/tenants"))
        return try CloudJSON.decode(Listing.self, from: data).tenants ?? []
    }

    /// A request to the LLM gateway (`/llm/v1/…`), where the key itself is the credential.
    public nonisolated func gatewayRequest(
        method: String,
        path: String,
        body: Data?,
        timeout: TimeInterval) throws -> URLRequest
    {
        guard let url = self.config.llmURL(path) else { throw CloudError.invalidResponse("bad path \(path)") }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("Bearer \(self.apiKey)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    // MARK: - Internals

    private func send(_ request: CloudAPIRequest, timeout: TimeInterval) async throws -> CloudHTTPResponse {
        let bearer = try await self.bearer()
        var urlRequest = try self.urlRequest(path: request.path, method: request.method, timeout: timeout)
        urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        if let body = request.body {
            urlRequest.httpBody = body
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return try await self.http.send(urlRequest)
    }

    private nonisolated func urlRequest(path: String, method: String, timeout: TimeInterval) throws -> URLRequest {
        guard let url = self.config.apiURL(path) else { throw CloudError.invalidResponse("bad path \(path)") }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func bearer() async throws -> String {
        if let token = self.token, token.expiresAt > Date().addingTimeInterval(Self.refreshMargin) {
            return token.value
        }
        let fresh = try await self.exchange()
        self.token = fresh
        return fresh.value
    }

    /// A fresh token for the chosen workspace.
    private func exchange() async throws -> Token {
        let keyBody = try CloudJSON.encode(["apiKey": self.apiKey])
        let base: Minted
        do {
            base = try await self.mint(path: "/api/auth/tenant-api-key-token", bearer: nil, body: keyBody)
        } catch CloudError.status(let code, _, _) where code == 400 || code == 401 {
            throw CloudError.keyRejected
        }
        var minted = base
        if let wanted = self.workspaceID, wanted != base.tenantId {
            do {
                minted = try await self.mint(
                    path: "/api/vscode/tenants/\(wanted)/token",
                    bearer: base.token,
                    body: Data("{}".utf8))
            } catch CloudError.status(let code, _, _) where code == 403 || code == 404 {
                // No longer a member there: fall back to the key's own workspace.
                self.workspaceID = nil
            }
        }
        return Token(
            value: minted.token,
            tenantID: minted.tenantId,
            expiresAt: Date().addingTimeInterval(TimeInterval(minted.expiresIn ?? 900)))
    }

    private func mint(path: String, bearer: String?, body: Data) async throws -> Minted {
        var request = try self.urlRequest(path: path, method: "POST", timeout: Self.apiTimeout)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        let response = try await self.http.send(request)
        return try CloudJSON.decode(Minted.self, from: Self.body(of: response))
    }

    static func body(of response: CloudHTTPResponse) throws -> Data {
        guard response.isSuccess else { throw CloudError.fromStatus(response.status, body: response.body) }
        return response.body
    }

    static func multipartBody(fileName: String, mimeType: String, data: Data, boundary: String) -> Data {
        let safeName = fileName.replacingOccurrences(of: "\"", with: "_")
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }
}
