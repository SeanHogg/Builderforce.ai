import Foundation

/// One HTTP answer from Builderforce: the status, its content type and the whole body.
public struct CloudHTTPResponse: Sendable, Equatable {
    public let status: Int
    public let contentType: String?
    public let body: Data

    public init(status: Int, contentType: String?, body: Data) {
        self.status = status
        self.contentType = contentType
        self.body = body
    }

    public var isSuccess: Bool {
        (200..<300).contains(self.status)
    }
}

/// How the cloud types reach the network — a seam so request building and decoding are
/// tested without one. Every call honours Task cancellation.
public protocol CloudHTTPClient: Sendable {
    /// Send `request` and read the whole answer.
    func send(_ request: URLRequest) async throws -> CloudHTTPResponse

    /// Send `request` and hand a 2xx event-stream body to `onLine` line by line. A JSON or
    /// failed answer is read whole and returned in `body` instead (`onLine` not called).
    func stream(_ request: URLRequest, onLine: (String) async throws -> Void) async throws -> CloudHTTPResponse
}

/// The live client: URLSession's async APIs.
public struct URLSessionCloudHTTPClient: CloudHTTPClient {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func send(_ request: URLRequest) async throws -> CloudHTTPResponse {
        do {
            let (data, response) = try await self.session.data(for: request)
            let http = response as? HTTPURLResponse
            return CloudHTTPResponse(
                status: http?.statusCode ?? 0,
                contentType: http?.value(forHTTPHeaderField: "Content-Type"),
                body: data)
        } catch {
            throw CloudError.wrap(error)
        }
    }

    public func stream(
        _ request: URLRequest,
        onLine: (String) async throws -> Void) async throws -> CloudHTTPResponse
    {
        do {
            let (bytes, response) = try await self.session.bytes(for: request)
            let http = response as? HTTPURLResponse
            let status = http?.statusCode ?? 0
            let contentType = http?.value(forHTTPHeaderField: "Content-Type")
            let isEventStream = (200..<300).contains(status)
                && !(contentType ?? "").lowercased().contains("application/json")
            if !isEventStream {
                var body = Data()
                for try await byte in bytes {
                    body.append(byte)
                }
                return CloudHTTPResponse(status: status, contentType: contentType, body: body)
            }
            for try await line in bytes.lines {
                try await onLine(line)
            }
            return CloudHTTPResponse(status: status, contentType: contentType, body: Data())
        } catch {
            throw CloudError.wrap(error)
        }
    }
}

/// The JSON coding every cloud call uses: stable key order, so a request body is
/// byte-for-byte predictable.
enum CloudJSON {
    static func encode(_ value: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value)
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw CloudError.invalidResponse(String(describing: error))
        }
    }
}
