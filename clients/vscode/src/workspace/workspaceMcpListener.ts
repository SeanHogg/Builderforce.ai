import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createWorkspaceMcpServer, type WorkspaceMcpTool } from "@builderforce/workspace-mcp";
import { ErrorCode, mcpRejection } from "@seanhogg/builderforce-mcp/protocol";
import { serveStatelessMcp } from "@seanhogg/builderforce-mcp/server";

const MAX_BODY_BYTES = 512 * 1024;

function reject(response: ServerResponse, status: number, code: number, message: string) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(mcpRejection(code, message)));
}

async function handleWorkspaceMcp(
  request: IncomingMessage,
  response: ServerResponse,
  auth: Buffer,
  tools: readonly WorkspaceMcpTool[],
) {
  const host = `127.0.0.1:${request.socket.localPort}`;
  const origin = `http://${host}`;
  if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== origin)) {
    return reject(response, 403, ErrorCode.InvalidRequest, "Invalid Workspace MCP origin");
  }
  if (request.url !== "/mcp") return reject(response, 404, ErrorCode.InvalidRequest, "Unknown Workspace MCP endpoint");

  const supplied = Buffer.from(request.headers.authorization ?? "");
  if (supplied.length !== auth.length || !timingSafeEqual(supplied, auth)) {
    response.setHeader("WWW-Authenticate", 'Bearer realm="builderforce-workspace"');
    return reject(response, 401, ErrorCode.InvalidRequest, "Unauthorized");
  }
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return reject(response, 405, ErrorCode.MethodNotFound, "This MCP server is stateless; use POST");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false }) as AsyncIterable<Buffer>) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      request.resume();
      return reject(response, 413, ErrorCode.InvalidRequest, "Workspace MCP request is too large");
    }
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return reject(response, 400, ErrorCode.ParseError, "Invalid JSON");
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const reply = await serveStatelessMcp(
    createWorkspaceMcpServer(tools),
    new Request(`${origin}/mcp`, { method: "POST", headers }),
    body,
  );
  response.writeHead(reply.status, Object.fromEntries(reply.headers));
  response.end(await reply.text());
}

export async function startWorkspaceMcpListener(tools: readonly WorkspaceMcpTool[]) {
  const authorization = `Bearer ${randomBytes(32).toString("base64url")}`;
  const auth = Buffer.from(authorization);
  const server = createServer({ headersTimeout: 10_000, requestTimeout: 15_000 }, (request, response) => {
    void handleWorkspaceMcp(request, response, auth, tools).catch(() => {
      if (response.headersSent) response.end();
      else reject(response, 500, ErrorCode.InternalError, "Workspace MCP request failed");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.unref();
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    authorization,
    dispose() {
      server.close();
      server.closeAllConnections();
    },
  };
}
